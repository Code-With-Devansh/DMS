

function publicUser(user) {
    const {hashedPassword, mfaSecret, mfaTempSecret, backupCodes, username, ...safeUser} = user;
    return safeUser;
}

function assertOrgScope(actor, targetOrg) {
    if (actor.role === "ORG_ADMIN" && actor.org !== targetOrg) {
        throw forbidden("organization administrator cannot access another organization");
    }
}

export async function listUsers(actor, filters) {
    const scopedFilters = actor.role === "ORG_ADMIN" ? {...filters, org: actor.org} : filters;
    const result = await userRepository.list(scopedFilters);
    return {...result, items: result.items.map(publicUser)};
}

export async function provisionUser(actor, data) {
    assertOrgScope(actor, data.org);
    if (await userRepository.findByEmail(data.email)) throw conflict("A user with this email already exists");

    const baseUsername = data.email.split("@")[0].replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 40) || "user";
    let username = baseUsername;
    for (let suffix = 1; await userRepository.findByUsername(username); suffix += 1) username = `${baseUsername}-${suffix}`;

    const activationToken = randomBytes(32).toString("hex");
    const user = await userRepository.create({
        ...data,
        username,
        hashedPassword: await argon2.hash(randomBytes(32).toString("base64url")),
        status: "ACTIVE",
    });
    return {user: publicUser(user), activationToken};
}

export async function getUser(actor, userId) {
    const user = await userRepository.findById(userId);
    if (!user) throw notFound("User not found");
    assertOrgScope(actor, user.org);
    return publicUser(user);
}

export async function updateUser(actor, userId, data) {
    const current = await userRepository.findById(userId);
    if (!current) throw notFound("User not found");
    assertOrgScope(actor, current.org);
    const updated = await userRepository.update(userId, data);
    return publicUser(updated);
}

export async function deactivateUser(actor, userId) {
    const current = await userRepository.findById(userId);
    if (!current) throw notFound("User not found");
    assertOrgScope(actor, current.org);
    const updated = await userRepository.update(userId, {status: "DISABLED"});
    await refreshTokenRepository.revokeAllForUser(userId);
    return publicUser(updated);
}

export async function resetMfa(actor, userId) {
    const current = await userRepository.findById(userId);
    if (!current) throw notFound("User not found");
    assertOrgScope(actor, current.org);
    await userRepository.resetMfa(userId);
    await refreshTokenRepository.revokeAllForUser(userId);
}

export async function listSessions(actor, userId) {
    const user = await getUser(actor, userId);
    const sessions = await refreshTokenRepository.listActiveForUser(user.id);
    return sessions.map((session) => ({...session, ip: "unknown", device: "unknown", lastSeenAt: session.createdAt}));
}

export async function revokeSession(actor, sessionId) {
    const session = await refreshTokenRepository.findById(sessionId);
    if (!session) throw notFound("Session not found");
    await getUser(actor, session.userId);
    await refreshTokenRepository.revokeById(sessionId, session.userId);
}
