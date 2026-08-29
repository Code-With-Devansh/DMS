// Sudo-proposal orchestration (GOVERNANCE.md §5). Every mutating op runs in one
// db.transaction together with its recordAudit(...) row, so a proposal, vote,
// objection or execution is never observable without its audit trail and never
// audited if it rolls back.
//
// Trust model: the client is never trusted for authority. The caller's role /
// pool membership is re-loaded from the DB on every op (never read off the JWT),
// eligibility and quorum are computed from the SUDO_ACTIONS registry + the actual
// admin_pools / sudo_approvals rows, and execute re-derives quorum from scratch
// rather than trusting any "approved" flag. Per-proposal ops SELECT ... FOR UPDATE
// the proposal row so concurrent votes/executions serialize.

import { and, count, desc, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  sudoProposals,
  sudoApprovals,
  sudoObjections,
} from "../db/schema/index.js";
import { recordAudit, AuditAction, TargetType } from "../audit/index.js";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import config from "../config/index.js";
import userRepository from "../repositories/user.repository.js";
import { getAction } from "./sudoActions.js";
import * as pools from "./pools.js";

// pg unique-violation SQLSTATE. node-postgres surfaces err.code + err.constraint.
function isUniqueViolation(err, constraint) {
  return err?.code === "23505" && (!constraint || err?.constraint === constraint);
}

// Turn a poolMath / registry validation Error into a 400 (leaves ApiError as-is).
function asBadRequest(err) {
  return err?.status ? err : badRequest(err?.message || "invalid governance payload");
}

async function loadActiveActor(actorId) {
  const actor = await userRepository.findById(actorId);
  if (!actor || actor.status !== "ACTIVE") {
    throw forbidden("actor is not an active user");
  }
  return actor;
}

// The org-less SECURITY_ADMIN pool is the cross-tier co-signer for every core
// sudo action. A pool never counts as its own cross-tier reviewer.
function isSecurityPoolTarget(targetSpec) {
  return targetSpec.poolType === "SECURITY_ADMIN" && targetSpec.org == null;
}

// Classify how `actorId` is entitled to act on a proposal whose action governs
// `targetSpec`. Returns "IN_POOL" | "CROSS_TIER_SECURITY_ADMIN" | null (ineligible).
async function classifyApprover(x, actorId, action, targetSpec) {
  if (await pools.isMember(x, actorId, targetSpec.poolType, targetSpec.org)) {
    return "IN_POOL";
  }
  if (
    action.crossTier === "SECURITY_ADMIN" &&
    !isSecurityPoolTarget(targetSpec) &&
    (await pools.isMember(x, actorId, "SECURITY_ADMIN", null))
  ) {
    return "CROSS_TIER_SECURITY_ADMIN";
  }
  return null;
}

// Resolve + guard the registry entry for an actionType.
function requireSupportedAction(actionType) {
  const action = getAction(actionType);
  if (!action) throw badRequest(`unknown action ${actionType}`);
  if (!action.supported) throw badRequest(`action ${actionType} is not yet supported`);
  return action;
}

function assertGovernanceEnabled() {
  if (!config.governance.enabled) {
    throw forbidden("governance subsystem is disabled");
  }
}

// ── file ───────────────────────────────────────────────────────────────────
// The proposer must be eligible to act on the target pool (a member of it, or a
// Security Admin for a cross-tier-governed action). Files a PENDING proposal.
export async function fileProposal(actorId, { actionType, payload }, ip) {
  assertGovernanceEnabled();
  const action = requireSupportedAction(actionType);
  try {
    action.validatePayload(payload);
  } catch (err) {
    throw asBadRequest(err);
  }
  const targetSpec = action.targetPool(payload);

  return db.transaction(async (tx) => {
    await loadActiveActor(actorId);

    const targetPool = await pools.getPool(tx, targetSpec.poolType, targetSpec.org);
    if (!targetPool) throw badRequest("target pool does not exist");

    // Eligible to propose: in the target pool, or a Security Admin (cross-tier).
    const role = await classifyApprover(tx, actorId, action, targetSpec);
    if (!role) throw forbidden("not eligible to propose against this pool");

    const delayHours = action.delayHours || 0;
    const executesAfter =
      delayHours > 0 ? new Date(Date.now() + delayHours * 3_600_000) : null;

    const [proposal] = await tx
      .insert(sudoProposals)
      .values({
        actionType,
        payload,
        status: "PENDING",
        proposedBy: actorId,
        org: targetSpec.org ?? null,
        executesAfter,
      })
      .returning();

    await recordAudit(tx, {
      actorId,
      action: AuditAction.SUDO_PROPOSAL_FILED,
      targetType: TargetType.GOVERNANCE_PROPOSAL,
      targetId: proposal.id,
      ip,
      details: { actionType, targetPool: targetSpec },
    });

    return proposal;
  });
}

// ── approve ──────────────────────────────────────────────────────────────────
// One freshly-authenticated step-up vote. stepUpJti (from req.stepUp) is persisted
// under UNIQUE(step_up_token_jti): reusing a token — even on a different proposal —
// is a 409. UNIQUE(proposal_id, approver_id) blocks a second vote by the same person.
export async function approveProposal(actorId, proposalId, stepUpJti, ip) {
  assertGovernanceEnabled();
  if (!stepUpJti) throw forbidden("step-up token is missing its jti; re-authenticate");

  return db.transaction(async (tx) => {
    await loadActiveActor(actorId);

    const [proposal] = await tx
      .select()
      .from(sudoProposals)
      .where(eq(sudoProposals.id, proposalId))
      .for("update");
    if (!proposal) throw notFound("proposal not found");
    if (proposal.status !== "PENDING") {
      throw conflict(`proposal is ${proposal.status.toLowerCase()}, not open for approval`);
    }

    const action = requireSupportedAction(proposal.actionType);
    const targetSpec = action.targetPool(proposal.payload);

    const approverPoolRole = await classifyApprover(tx, actorId, action, targetSpec);
    if (!approverPoolRole) throw forbidden("not eligible to approve this proposal");

    let approval;
    try {
      [approval] = await tx
        .insert(sudoApprovals)
        .values({ proposalId, approverId: actorId, approverPoolRole, stepUpTokenJti: stepUpJti })
        .returning();
    } catch (err) {
      if (isUniqueViolation(err, "sudo_approvals_proposal_id_approver_id_key")) {
        throw conflict("you have already voted on this proposal");
      }
      if (isUniqueViolation(err, "sudo_approvals_step_up_token_jti_key")) {
        throw conflict("this step-up token has already been used to vote");
      }
      throw err;
    }

    await recordAudit(tx, {
      actorId,
      action: AuditAction.SUDO_APPROVED,
      targetType: TargetType.GOVERNANCE_PROPOSAL,
      targetId: proposalId,
      ip,
      details: { approverPoolRole },
    });

    return approval;
  });
}

// ── object ───────────────────────────────────────────────────────────────────
// A reviewer eligible to approve may instead object. Once minObjectorsToHalt
// objections land, the proposal flips to OBJECTED and can no longer be approved
// or executed (fail-safe halt).
export async function objectProposal(actorId, proposalId, reason, ip) {
  assertGovernanceEnabled();

  return db.transaction(async (tx) => {
    await loadActiveActor(actorId);

    const [proposal] = await tx
      .select()
      .from(sudoProposals)
      .where(eq(sudoProposals.id, proposalId))
      .for("update");
    if (!proposal) throw notFound("proposal not found");
    if (proposal.status !== "PENDING") {
      throw conflict(`proposal is ${proposal.status.toLowerCase()}, not open for objection`);
    }

    const action = requireSupportedAction(proposal.actionType);
    const targetSpec = action.targetPool(proposal.payload);
    const role = await classifyApprover(tx, actorId, action, targetSpec);
    if (!role) throw forbidden("not eligible to object to this proposal");

    await tx
      .insert(sudoObjections)
      .values({ proposalId, objectorId: actorId, reason: reason ?? null });

    const [{ total }] = await tx
      .select({ total: count() })
      .from(sudoObjections)
      .where(eq(sudoObjections.proposalId, proposalId));

    const halted = Number(total) >= config.governance.minObjectorsToHalt;
    if (halted) {
      await tx
        .update(sudoProposals)
        .set({ status: "OBJECTED" })
        .where(eq(sudoProposals.id, proposalId));
    }

    await recordAudit(tx, {
      actorId,
      action: AuditAction.SUDO_OBJECTED,
      targetType: TargetType.GOVERNANCE_PROPOSAL,
      targetId: proposalId,
      ip,
      details: { reason: reason ?? null, halted },
    });

    return { proposalId, halted, status: halted ? "OBJECTED" : "PENDING" };
  });
}

// ── execute ──────────────────────────────────────────────────────────────────
// Re-derives quorum from the actual approval rows (never a client flag): the
// target pool's k in-pool votes AND ≥1 cross-tier Security-Admin co-sign, and any
// executesAfter delay elapsed. Then applies the pool mutation and records
// SUDO_EXECUTED, linking the proposal to that audit entry.
export async function executeProposal(actorId, proposalId, ip) {
  assertGovernanceEnabled();

  return db.transaction(async (tx) => {
    const actor = await loadActiveActor(actorId);

    const [proposal] = await tx
      .select()
      .from(sudoProposals)
      .where(eq(sudoProposals.id, proposalId))
      .for("update");
    if (!proposal) throw notFound("proposal not found");
    if (proposal.status !== "PENDING") {
      throw conflict(`proposal is ${proposal.status.toLowerCase()}, not executable`);
    }

    const action = requireSupportedAction(proposal.actionType);
    const targetSpec = action.targetPool(proposal.payload);

    // The executor must themselves be an eligible party to the pool.
    const executorRole = await classifyApprover(tx, actorId, action, targetSpec);
    if (!executorRole) throw forbidden("not eligible to execute this proposal");

    if (proposal.executesAfter && proposal.executesAfter.getTime() > Date.now()) {
      throw conflict("proposal delay window has not elapsed");
    }

    const targetPool = await pools.getPool(tx, targetSpec.poolType, targetSpec.org);
    if (!targetPool) throw badRequest("target pool no longer exists");

    // Quorum from the real rows.
    const approvals = await tx
      .select()
      .from(sudoApprovals)
      .where(eq(sudoApprovals.proposalId, proposalId));
    const inPool = approvals.filter((a) => a.approverPoolRole === "IN_POOL").length;
    const crossTier = approvals.filter(
      (a) => a.approverPoolRole === "CROSS_TIER_SECURITY_ADMIN",
    ).length;

    if (inPool < targetPool.k) {
      throw conflict(`quorum not met: ${inPool}/${targetPool.k} in-pool approvals`);
    }
    if (action.crossTier === "SECURITY_ADMIN" && crossTier < 1) {
      throw conflict("quorum not met: a cross-tier Security Admin co-sign is required");
    }

    // Apply the mutation. Pool membership is the authority of record; we do NOT
    // also mutate users.role here (RBAC is the coarse gate — see GOVERNANCE.md /
    // authorize.js). Roster edits keep the stored k and guard m so a pool can
    // never be driven ungovernable via the normal flow.
    const payload = proposal.payload;
    if (proposal.actionType === "APPOINT_ORG_ADMIN") {
      const target = await userRepository.findById(payload.userId);
      if (!target) throw notFound("target user not found");
      if (await pools.isMember(tx, payload.userId, targetSpec.poolType, targetSpec.org)) {
        throw conflict("user is already a member of this pool");
      }
      await pools.addMember(tx, targetPool.id, payload.userId);
      await pools.setThreshold(tx, targetPool.id, { k: targetPool.k, m: targetPool.m + 1 });
    } else if (proposal.actionType === "REMOVE_ORG_ADMIN") {
      const newM = targetPool.m - 1;
      if (newM < 2 || targetPool.k > newM) {
        throw badRequest(
          "cannot remove: pool would fall below its quorum; lower k via CHANGE_POOL_THRESHOLD first",
        );
      }
      const removed = await pools.removeMember(tx, targetPool.id, payload.userId);
      if (!removed) throw notFound("user is not a member of this pool");
      await pools.setThreshold(tx, targetPool.id, { k: targetPool.k, m: newM });
    } else if (proposal.actionType === "CHANGE_POOL_THRESHOLD") {
      try {
        await pools.setThreshold(tx, targetPool.id, { k: payload.k, m: targetPool.m });
      } catch (err) {
        throw asBadRequest(err);
      }
    } else {
      // Unreachable: requireSupportedAction gates the set above.
      throw badRequest(`execution not implemented for ${proposal.actionType}`);
    }

    const auditRow = await recordAudit(tx, {
      actorId: actor.id,
      action: AuditAction.SUDO_EXECUTED,
      targetType: TargetType.ADMIN_POOL,
      targetId: targetPool.id,
      ip,
      details: { proposalId, actionType: proposal.actionType },
    });

    const [updated] = await tx
      .update(sudoProposals)
      .set({ status: "EXECUTED", executedAt: new Date(), executedEntryId: auditRow.id })
      .where(eq(sudoProposals.id, proposalId))
      .returning();

    return updated;
  });
}

// ── reads (no audit) ──────────────────────────────────────────────────────────
export async function listProposals({ status, actionType, org, page = 1, pageSize = 20 }) {
  const conds = [];
  if (status) conds.push(eq(sudoProposals.status, status));
  if (actionType) conds.push(eq(sudoProposals.actionType, actionType));
  if (org) conds.push(eq(sudoProposals.org, org));
  const where = conds.length ? and(...conds) : undefined;

  const [items, [{ total }]] = await Promise.all([
    db
      .select()
      .from(sudoProposals)
      .where(where)
      .orderBy(desc(sudoProposals.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ total: count() }).from(sudoProposals).where(where),
  ]);
  return { items, total: Number(total), page, pageSize };
}

export async function getProposal(proposalId) {
  const [proposal] = await db
    .select()
    .from(sudoProposals)
    .where(eq(sudoProposals.id, proposalId));
  if (!proposal) throw notFound("proposal not found");

  const [approvals, objections] = await Promise.all([
    db.select().from(sudoApprovals).where(eq(sudoApprovals.proposalId, proposalId)),
    db.select().from(sudoObjections).where(eq(sudoObjections.proposalId, proposalId)),
  ]);
  return { ...proposal, approvals, objections };
}
