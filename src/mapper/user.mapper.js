

const PERMISSIONS_BY_ROLE = {
    INVESTIGATING_OFFICER: ["cases:read", "documents:read", "documents:write"],
    SUPERVISOR: ["cases:read", "cases:manage", "documents:read", "documents:write"],
    PROSECUTOR: ["cases:read", "documents:read", "documents:sign"],
    JUDGE: ["cases:read", "documents:read", "documents:sign"],
    COURT_CLERK: ["cases:read", "documents:read", "documents:write"],
    FORENSIC_ANALYST: ["documents:read", "documents:write"],
    RECORDS_ADMIN: ["documents:read", "documents:write", "users:read"],
    SECURITY_ADMIN: ["documents:read", "audit:read", "users:manage"],
    ORG_ADMIN: ["users:manage", "cases:manage", "documents:manage"],
    SYSTEM_ADMIN: ["*"],
    AUDITOR: ["audit:read", "documents:read", "cases:read"],
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
