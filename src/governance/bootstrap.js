// One-time genesis ceremony (GOVERNANCE.md §6.4). Establishes the first admin
// pools + their founding members and writes the genesis audit entry — the root of
// the governance chain. Self-disabling: the precondition is simply "admin_pools is
// empty", checked under an advisory lock, so a second call can never succeed.
//
// SECURITY: this endpoint is necessarily unauthenticated (no admin exists yet). It
// is gated by (a) a secret commitment — sha256(providedSecret) must equal the
// pre-configured GOVERNANCE_GENESIS_COMMITMENT — and (b) the empty-admin_pools
// precondition, and is intended to be called only over an admin-only channel by
// the genesis CLI. The founding secret itself is NEVER persisted; genesis_shares
// stores holder LABELS and cold-storage flags ONLY — never Shamir share material.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import argon2 from "argon2";
import { count, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { users, adminPools, genesisShares } from "../db/schema/index.js";
import { recordAudit, AuditAction, TargetType } from "../audit/index.js";
import { badRequest, conflict, forbidden } from "../lib/errors.js";
import config from "../config/index.js";
import userRepository from "../repositories/user.repository.js";
import { validateThreshold } from "./poolMath.js";
import * as pools from "./pools.js";

// Stable advisory-lock key serializing the bootstrap precondition check.
// ("GOVB" as bytes = 0x474F5642.)
const BOOTSTRAP_LOCK_KEY = 1196314690;

// Constant-time comparison of the provided secret's sha256 against the configured
// commitment. Returns false (rather than throwing) on any shape mismatch.
function commitmentMatches(secret) {
  const configured = config.governance.genesisCommitment;
  if (!configured) return false;
  const provided = createHash("sha256").update(String(secret), "utf8").digest("hex");
  if (provided.length !== configured.length) return false;
  try {
    return timingSafeEqual(Buffer.from(provided, "hex"), Buffer.from(configured, "hex"));
  } catch {
    return false;
  }
}

function deriveUsername(email) {
  const base =
    email.split("@")[0].replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 40) || "user";
  return base;
}

// Resolve a roster entry to a users row id: reuse an existing user by email
// (link), otherwise create one. Runs inside the ceremony tx.
async function upsertRosterUser(tx, entry, usernameTaken) {
  const existing = await userRepository.findByEmail(entry.email);
  if (existing) return { id: existing.id, role: existing.role, created: false };

  let username = entry.username || deriveUsername(entry.email);
  for (let suffix = 1; usernameTaken.has(username); suffix += 1) {
    username = `${entry.username || deriveUsername(entry.email)}-${suffix}`;
  }
  usernameTaken.add(username);

  const [row] = await tx
    .insert(users)
    .values({
      fullName: entry.fullName,
      role: entry.role,
      org: entry.org,
      badgeId: entry.badgeId ?? null,
      email: entry.email,
      clearance: entry.clearance,
      jurisdiction: entry.jurisdiction,
      status: "ACTIVE",
      username,
      // Founders set a real password out-of-band (activation). Seed a random,
      // unusable hash so the NOT NULL column is satisfied without a known secret.
      hashedPassword: await argon2.hash(randomBytes(32).toString("base64url")),
    })
    .returning();
  return { id: row.id, role: row.role, created: true };
}

// bootstrap({ secret, roster, pools, shares }, ip)
// - roster: [{ fullName, email, role, org, clearance, jurisdiction, badgeId?, username? }]
// - pools:  [{ poolType, org?, k?, members: [email, ...] }]   (m = members.length)
// - shares: [{ holderLabel, isColdStored? }]                  (metadata only)
export async function bootstrap({ secret, roster, pools: poolSpecs, shares = [] }, ip) {
  if (!config.governance.enabled) throw forbidden("governance subsystem is disabled");
  if (!commitmentMatches(secret)) throw forbidden("genesis secret does not match commitment");
  if (!Array.isArray(roster) || roster.length === 0) throw badRequest("roster must be non-empty");
  if (!Array.isArray(poolSpecs) || poolSpecs.length === 0) throw badRequest("at least one pool is required");

  // Pre-validate every threshold before touching the DB (fail fast, no partial state).
  for (const spec of poolSpecs) {
    const m = Array.isArray(spec.members) ? spec.members.length : 0;
    try {
      validateThreshold(spec.k, m);
    } catch (err) {
      throw badRequest(`pool ${spec.poolType}${spec.org ? `/${spec.org}` : ""}: ${err.message}`);
    }
  }

  return db.transaction(async (tx) => {
    // Serialize + enforce the one-time precondition: admin_pools must be empty.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${BOOTSTRAP_LOCK_KEY})`);
    const [{ existing }] = await tx.select({ existing: count() }).from(adminPools);
    if (Number(existing) > 0) throw conflict("governance has already been bootstrapped");

    // Create/link founders, keyed by email.
    const usernameTaken = new Set();
    const byEmail = new Map();
    for (const entry of roster) {
      const u = await upsertRosterUser(tx, entry, usernameTaken);
      byEmail.set(entry.email, u);
    }

    // Create pools + attach members.
    const createdPools = [];
    for (const spec of poolSpecs) {
      const m = spec.members.length;
      const pool = await pools.createPool(tx, {
        poolType: spec.poolType,
        org: spec.org ?? null,
        k: spec.k,
        m,
      });
      for (const email of spec.members) {
        const member = byEmail.get(email);
        if (!member) throw badRequest(`pool member ${email} is not in the roster`);
        await pools.addMember(tx, pool.id, member.id);
      }
      createdPools.push({ id: pool.id, poolType: pool.poolType, org: pool.org, k: pool.k, m: pool.m });
    }

    // Genesis audit entry #0. actor_id is a NOT NULL FK → users(id); use the first
    // System Admin founder (fall back to the first founder) so the FK resolves.
    const founders = roster.map((e) => byEmail.get(e.email));
    const genesisActor =
      founders.find((f) => f.role === "SYSTEM_ADMIN") || founders[0];

    const genesisEntry = await recordAudit(tx, {
      actorId: genesisActor.id,
      action: AuditAction.GENESIS_WRITTEN,
      targetType: TargetType.ADMIN_POOL,
      targetId: null,
      ip,
      details: {
        pools: createdPools.map((p) => ({ poolType: p.poolType, org: p.org, k: p.k, m: p.m })),
        founders: roster.length,
        shares: shares.length,
      },
    });

    // Genesis share METADATA only — never the shares themselves.
    for (const s of shares) {
      await tx.insert(genesisShares).values({
        holderLabel: s.holderLabel,
        isColdStored: s.isColdStored ?? true,
        distributedAt: null,
      });
    }

    return {
      bootstrapped: true,
      genesisEntryId: genesisEntry.id,
      pools: createdPools,
      founders: founders.length,
      shares: shares.length,
    };
  });
}
