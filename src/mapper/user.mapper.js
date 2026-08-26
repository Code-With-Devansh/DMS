

const PERMISSIONS_BY_ROLE = {
    INVESTIGATING_OFFICER: ["case:read", "document:read", "document:write"],
    SUPERVISOR: ["case:read", "case:manage", "document:read", "document:write"],
    PROSECUTOR: ["case:read", "document:read", "document:sign"],
    JUDGE: ["case:read", "document:read", "document:sign"],
    COURT_CLERK: ["case:read", "document:read", "document:write"],
    FORENSIC_ANALYST: ["document:read", "document:write"],
    RECORDS_ADMIN: ["document:read", "document:write", "user:read"],
    SECURITY_ADMIN: ["document:read", "audit:read", "user:manage"],
    ORG_ADMIN: ["user:manage", "case:manage", "document:manage"],
    SYSTEM_ADMIN: ["*"],
    AUDITOR: ["audit:read", "document:read", "case:read"],
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
