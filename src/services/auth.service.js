import argon2 from "argon2";
import speakeasy from "speakeasy";
import qrcode from "qrcode";
import {toMe} from "../mapper/user.mapper.js";
import {generateBackupCodes} from "../utils/generateBackupCodes.js";
import {badRequest, forbidden, invalidCredentials, notFound, unauthenticated,} from "../lib/errors.js";
import {
    getRefreshExpiryTime,
    signAccessToken,
    signMfaToken,
    signRefreshToken,
    signStepUpToken,
    verifyStepUpToken
} from "../lib/tokens.js";

import {db} from "../db/index.js";
import {users} from "../db/schema/users.js";
import {refreshTokens} from "../db/schema/refresh_tokens.js";
import {hashRefreshToken} from "../utils/hashRefreshToken.js";
import redisClient from "../config/redis.js";
import { and, eq } from "drizzle-orm";


// Step 1 of login: validate credentials and hand back a short-lived MFA token
export async function login({username, password}) {
    const [user] = await db.select().from(users).where(eq(users.username, username), eq(users.status, "ACTIVE")).limit(1);
    if (!user) throw notFound("User not found");
    const passwordValid = await argon2.verify(user.hashedPassword, password);
    if (!passwordValid) throw invalidCredentials("Invalid username or password");
    const mfaToken = signMfaToken({sub: user.id, username: user.username});
    if (user.mfaEnrolled) {
        return {mfaRequired: true, mfaToken};
    }
    return {mfaRequired: false, mfaToken };
}

export async function changePassword(userId, {currentPassword, newPassword}) {
    const [user] = await db.select().from(users).where(and(eq(users.id, userId), eq(users.status,"ACTIVE"))).limit(1);
    if (!user) throw notFound("User not found");
    if (currentPassword === newPassword) {
        throw badRequest("New password cannot be the same as the current password.");
    }
    if (user.lastLoginAt) {
        throw badRequest("Password change is not allowed.");
    }

    if (!await argon2.verify(user.hashedPassword, currentPassword)) {
        throw invalidCredentials();
    }
    await db.update(users).set({hashedPassword: await argon2.hash(newPassword)}).where(eq(users.id,userId));
}

// Begin first-time MFA enrollment: generate a TOTP secret + QR for the
// authenticator app and stash the secret as pending on the user.
export async function startMfaEnrollment(userId) {
    const [user] = await db.select().from(users).where(eq(users.id,userId), eq(users.status, "ACTIVE")).limit(1);
    if (!user) throw notFound("User not found");
    if (user.mfaEnrolled) {
        throw badRequest("User is already enrolled in MFA");
    }
    const secret = speakeasy.generateSecret({
        name: `DMS (${user.username})`,
        issuer: "DMS",
    });
    await db.update(users).set({mfaTempSecret: secret.base32}).where(eq(users.id,userId));
    const qrDataUrl = await qrcode.toDataURL(secret.otpauth_url);
    return {
        secret: secret.base32,
        otpAuthUrl: secret.otpauth_url,
        qrDataUrl,
    };
}

// Finish first-time enrollment: verify the first code against the pending secret,
// promote it to the active secret, generate backup codes, and issue tokens.
export async function verifyMfaEnrollment(userId, code) {
    const [user] = await db.select().from(users).where(eq(users.id,userId), eq(users.status,"ACTIVE")).limit(1);
    if (!user) throw notFound("User not found");
    if (!user.mfaTempSecret) throw badRequest("No pending MFA enrollment found");
    if (user.mfaEnrolled) {
        throw badRequest("User is already enrolled in MFA");
    }
    const verified = speakeasy.totp.verify({
        secret: user.mfaTempSecret,
        token: code,
        encoding: "base32", window: 1,
    });

    if (!verified) throw badRequest("Invalid MFA code");
    const backupCodes = generateBackupCodes(8);
    // Hash every generated code
    const hashedCodes = await Promise.all(
        backupCodes.map(async (code) => {
            const hash = await argon2.hash(code);
            return {codeHash: hash, used: false};
        })
    );
    // saving the hashed codes as a JSON string in the database
    const stringifiedCodes = JSON.stringify(hashedCodes);
    const refreshToken = signRefreshToken({sub: user.id, username: user.username});
    const accessToken = signAccessToken({sub: user.id, username: user.username});
    const tempSecret = user.mfaTempSecret;
    await db.transaction(async (tx) => {
            // updating user
            await tx.update(users).set({
                mfaTempSecret: null,
                mfaSecret: tempSecret,
                mfaEnrolled: true,
                lastLoginAt: new Date(),
                backupCodes: stringifiedCodes
            })
            // revoking previous refresh token for that user
            await tx.update(refreshTokens).set({revokedAt: new Date()}).where(eq(refreshTokens.userId, userId));
            // inserting newly generated refresh token
            await tx.insert(refreshTokens).values({
                userId,
                tokenHash: hashRefreshToken(refreshToken),
                expiresAt: new Date(getRefreshExpiryTime(refreshToken) * 1000)
            });
     }
    );
    const [freshUser] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    return {backupCodes, user: toMe(freshUser), accessToken, refreshToken};
}

// Regular login MFA step: verify a code against the active secret and issue tokens.
export async function verifyMfa(userId, code) {
    const [user] = await db.select().from(users).where(eq(users.id, userId), eq(users.status, "ACTIVE")).limit(1);
    if (!user) throw notFound("User not found");
    if (!user.mfaSecret || !user.mfaEnrolled) {
        throw badRequest("User is not enrolled in MFA");
    }
    const verified = speakeasy.totp.verify({
        secret: user.mfaSecret,
        token: code,
        encoding: "base32", window: 1,
    });
    if (!verified) throw unauthenticated("Invalid MFA code");
    const accessToken = signAccessToken({sub: user.id, username: user.username});
    const refreshToken = signRefreshToken({sub: user.id, username: user.username});
    await db.transaction(async (tx) => {
        await tx.update(users).set({lastLoginAt: new Date()}).where(eq(users.id,userId));
        await tx.update(refreshTokens).set({revokedAt: new Date()}).where(eq(refreshTokens.userId, userId));
        // inserting new refreshToken
        await tx.insert(refreshTokens).values({
            tokenHash: hashRefreshToken(refreshToken),
            userId,
            // converting jwt expiry to js expiry
            expiresAt: new Date(getRefreshExpiryTime(refreshToken) * 1000)
        })
    });

    const [freshUser] = await db.select().from(users).where(eq(users.id, userId), eq(users.status, "ACTIVE")).limit(1);
    return {user: toMe(freshUser), accessToken, refreshToken};
}

export async function createStepUpToken(userId, code) {
    const [user] = await db.select().from(users).where(and(users.id.eq(userId), users.status.eq("ACTIVE"))).limit(1);
    if (!user || user.status !== "ACTIVE") {
        throw notFound("User not found");
    }
    if (!user.mfaSecret || !user.mfaEnrolled) {
        throw badRequest("User is not enrolled in MFA");
    }

    const verified = speakeasy.totp.verify({
        secret: user.mfaSecret,
        token: code,
        encoding: "base32", window: 1,
    });
    if (!verified) throw unauthenticated("Invalid MFA code");

    const stepUpToken = signStepUpToken({sub: user.id});
    const payload = verifyStepUpToken(stepUpToken);
    return {
        stepUpToken,
        expiresAt: new Date(payload.exp * 1000),
    };
}

export async function revokeRefreshTokens(userId) {
    await db.transaction(async (tx) => {
        await db.update(refreshToken, {revokedAt: new Date().getTime()}).where(users.id, userId);
    });
}

// Exchange a valid refresh token for a fresh access token (refresh stays put).
export async function refresh(userId, prevAccessToken, prevRefreshToken) {
    const accessToken = signAccessToken({sub: userId});
    const refreshToken = signRefreshToken({sub: userId});
    if(prevAccessToken){
        await redisClient.set(`${prevAccessToken}`, "revoked");
    }

    await redisClient.set(`${prevRefreshToken}`, "revoked");
    await db.insert(refreshTokens).values({
        tokenHash: hashRefreshToken(refreshToken),
        userId: userId,
        expiresAt: new Date(getRefreshExpiryTime(refreshToken) * 1000)
    });
    return {accessToken, refreshToken};
}

export async function logout(userId, accessToken) {
    redisClient.set(accessToken, "revoked");
    const [user] = await db.select().from(users).where(eq(users.id, userId)).first();
    if (!user) throw notFound("User not found");
    const refreshTokens = await db
        .select()
        .from(refreshTokens)
        .where(
            and(
                eq(refreshTokens.userId, userId), // Match the token table's column
                isNull(refreshTokens.revokedAt)
            )
        );
    for (const refreshToken of refreshTokens) {
        redisClient.set(hashRefreshToken(refreshToken), "revoked");
    }
    await db.transaction(async (tx) => {
        await tx.update(refreshTokens).set({revokedAt: new Date().getTime()}).where(users.id.eq(userId));
    });
}

// Current-user profile for GET /me (id comes from the verified access token).
export async function getMe(userId) {
    const [user] = await db.select().from(users).where(eq(users.id, userId), eq(users.status, "ACTIVE")).limit(1);
    if (!user) throw notFound("User not found");
    return toMe(user);
}
