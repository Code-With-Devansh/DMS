// Declarative registry of privileged ("sudo") actions (GOVERNANCE.md §5). Each
// entry declares:
//   - targetPool(payload) → { poolType, org }: whose k-of-m quorum governs it,
//   - crossTier: the pool type that MUST additionally co-sign (a pool can never
//     approve a change to itself purely from within — principle of separation),
//   - delayHours: execution delay (0 for the foundational actions; the Tier-2
//     reinstatement window is deferred), and
//   - validatePayload(payload): an action-specific shape guard.
//
// The proposals service reads THIS — never the client — to decide who may propose,
// what constitutes quorum, and how to execute. Adding or altering an action is a
// single-place change.
//
// Only the three foundational actions are `supported` in this pass. The rest are
// registered (so the enum + audit vocabulary and the payload contract are stable)
// but rejected at file time with badRequest("action not yet supported") until
// their pass lands — no destructive migration needed to turn them on later.

function requireFields(payload, fields) {
  for (const f of fields) {
    const v = payload?.[f];
    if (v === undefined || v === null || v === "") {
      throw new Error(`payload.${f} is required`);
    }
  }
}

export const SUDO_ACTIONS = Object.freeze({
  // Appoint a user into an org's ORG_ADMIN pool. Quorum: that org's ORG_ADMIN
  // pool; co-sign: a Security Admin (cross-tier).
  APPOINT_ORG_ADMIN: {
    supported: true,
    crossTier: "SECURITY_ADMIN",
    delayHours: 0,
    targetPool: (p) => ({ poolType: "ORG_ADMIN", org: p.org }),
    validatePayload: (p) => requireFields(p, ["org", "userId"]),
  },

  // Remove a user from an org's ORG_ADMIN pool. Same quorum + co-sign as appoint.
  REMOVE_ORG_ADMIN: {
    supported: true,
    crossTier: "SECURITY_ADMIN",
    delayHours: 0,
    targetPool: (p) => ({ poolType: "ORG_ADMIN", org: p.org }),
    validatePayload: (p) => requireFields(p, ["org", "userId"]),
  },

  // Change a pool's quorum threshold k. Quorum: the affected pool; co-sign: a
  // Security Admin (cross-tier) — a pool may never re-threshold itself alone.
  CHANGE_POOL_THRESHOLD: {
    supported: true,
    crossTier: "SECURITY_ADMIN",
    delayHours: 0,
    targetPool: (p) => ({ poolType: p.poolType, org: p.org ?? null }),
    validatePayload: (p) => {
      requireFields(p, ["poolType", "k"]);
      if (!Number.isInteger(p.k)) throw new Error("payload.k must be an integer");
    },
  },

  // ── deferred: registered so the vocabulary is stable, not yet executable ──
  APPOINT_SYSTEM_ADMIN: { supported: false },
  REMOVE_SYSTEM_ADMIN: { supported: false },
  ONBOARD_ORG: { supported: false },
  CHANGE_ABAC_POLICY: { supported: false },
  POOL_REINSTATEMENT: { supported: false },
  GENESIS_REPLACEMENT: { supported: false },
});

// Registry lookup; null for an unknown actionType (the zod enum already rejects
// values outside sudo_action_type, so null here means "known enum, no entry").
export function getAction(actionType) {
  return SUDO_ACTIONS[actionType] ?? null;
}
