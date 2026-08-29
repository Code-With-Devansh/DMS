

const PERMISSIONS_BY_ROLE = {
    INVESTIGATING_OFFICER: ["case:read", "document:read", "document:write"],
    SUPERVISOR: ["case:read", "case:manage", "document:read", "document:write"],
    PROSECUTOR: ["case:read", "document:read", "document:sign"],
    JUDGE: ["case:read", "document:read", "document:sign"],
    COURT_CLERK: ["case:read", "document:read", "document:write"],
    FORENSIC_ANALYST: ["document:read", "document:write"],
    RECORDS_ADMIN: ["document:read", "document:write", "user:read"],
    SECURITY_ADMIN: ["document:read", "audit:read", "user:manage", "governance:read", "governance:propose", "governance:approve"],
    ORG_ADMIN: ["user:manage", "case:manage", "document:manage", "governance:read", "governance:propose", "governance:approve"],
    SYSTEM_ADMIN: ["*"],
    // governance:vote is reserved for the deferred Tier-2 Auditor quorum and is
    // kept SEPARATE from audit:read — it never grants approve/execute authority.
    AUDITOR: ["audit:read", "document:read", "case:read", "governance:read", "governance:vote"],
};


export function toMe(user) {
    return {
        id: user.id,
        username: user.username,
        fullName: user.fullName,
        role: user.role,
        org: user.org,
        badgeId: user.badgeId,
        email: user.email,
        clearance: user.clearance,
        jurisdiction: user.jurisdiction,
        status: user.status,
        mfaEnrolled: user.mfaEnrolled,
        createdAt: user.createdAt,
        lastLoginAt: user.lastLoginAt,
        permissions: PERMISSIONS_BY_ROLE[user.role] ?? [],
    };
}
