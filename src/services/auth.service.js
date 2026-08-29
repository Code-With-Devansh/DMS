import argon2 from "argon2";
import speakeasy from "speakeasy";
import qrcode from "qrcode";
import { randomUUID } from "node:crypto";
import { toMe } from "../mapper/user.mapper.js";
import { generateBackupCodes } from "../utils/generateBackupCodes.js";
import { badRequest, forbidden, invalidCredentials, notFound, unauthenticated, } from "../lib/errors.js";
import {
    signAccessToken,
    signMfaToken,
    signRefreshToken,
    signStepUpToken,
    verifyStepUpToken
} from "../lib/tokens.js";

import userRepository from "../repositories/user.repository.js";
import redisClient from "../config/redis.js";
import { hashRefreshToken } from "../utils/hashRefreshToken.js";


// Step 1 of login: validate credentials and hand back a short-lived MFA token
export async function login({ username, password }) {
    const user = await userRepository.findActiveByUsername(username);
    if (!user) throw notFound("Invalid username or password.");
    const passwordValid = await argon2.verify(user.hashedPassword, password);
    if (!passwordValid) throw invalidCredentials("Invalid username or password");
    const mfaToken = signMfaToken({ sub: user.id, username: user.username });
    if (user.mfaEnrolled) {
        return { mfaRequired: true, mfaToken };
    }
    return { mfaRequired: false, mfaToken };
}

export async function changePassword(userId, { currentPassword, newPassword }) {
    const user = await userRepository.findActiveById(userId);
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
    await userRepository.setPasswordHash(userId, await argon2.hash(newPassword));
}

// Begin first-time MFA enrollment: generate a TOTP secret + QR for the
// authenticator app and stash the secret as pending on the user.
export async function startMfaEnrollment(userId) {
    const user = await userRepository.findActiveById(userId);
    if (!user) throw notFound("User not found");
    if (user.mfaEnrolled) {
        throw badRequest("User is already enrolled in MFA");
    }
    const secret = speakeasy.generateSecret({
        name: `DMS (${user.username})`,
        issuer: "DMS",
    });
    await userRepository.setPendingMfaSecret(userId, secret.base32);
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
    const user = await userRepository.findActiveById(userId);
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
    const hashedCodes = await Promise.all(
        backupCodes.map(async (code) => {
            const hash = await argon2.hash(code);
            return { codeHash: hash, used: false };
        })
    );
    const stringifiedCodes = JSON.stringify(hashedCodes);
    const refreshToken = signRefreshToken({ sub: user.id, username: user.username });
    const accessToken = signAccessToken({ sub: user.id, username: user.username });
    await userRepository.completeMfaEnrollment({
        userId,
        tempSecret: user.mfaTempSecret,
        backupCodes: stringifiedCodes,
        refreshToken,
    });
    const freshUser = await userRepository.findById(userId);
    redisClient.set(`${hashRefreshToken(refreshToken)}`, "active");
    redisClient.set(`${accessToken}`, "active");

    return { backupCodes, user: toMe(freshUser), accessToken, refreshToken };
}

// Regular login MFA step: verify a code against the active secret and issue tokens.
export async function verifyMfa(userId, code) {
    const user = await userRepository.findActiveById(userId);
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
    const accessToken = signAccessToken({ sub: user.id, username: user.username });
    const refreshToken = signRefreshToken({ sub: user.id, username: user.username });
    await userRepository.completeMfaLogin({ userId, refreshToken });
    
    redisClient.set(`${hashRefreshToken(refreshToken)}`, "active");
    redisClient.set(`${accessToken}`, "active");

    const freshUser = await userRepository.findActiveById(userId);
    return { user: toMe(freshUser), accessToken, refreshToken };
}

export async function createStepUpToken(userId, code) {
    const user = await userRepository.findActiveById(userId);
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

    // jti makes each step-up token single-use as a governance vote: the
    // governance approve path persists it under a UNIQUE constraint, so replaying
    // the same token (even against a different proposal) is rejected as a conflict.
    const stepUpToken = signStepUpToken({ sub: user.id, jti: randomUUID() });
    const payload = verifyStepUpToken(stepUpToken);
    return {
        stepUpToken,
        expiresAt: new Date(payload.exp * 1000),
    };
}


// Exchange a valid refresh token for a fresh access token (refresh stays put).
export async function refresh(userId, prevAccessToken, prevRefreshToken) {
    const accessToken = signAccessToken({ sub: userId });
    const refreshToken = signRefreshToken({ sub: userId });
    if (prevAccessToken) {
        await redisClient.set(`${prevAccessToken}`, "revoked");
    }

    if(prevRefreshToken) {
        const isRevoked = await redisClient.get(`${hashRefreshToken(prevRefreshToken)}`);
        if (isRevoked == "revoked") {
            await userRepository.revokeRefreshTokenForUser(userId);
            throw forbidden("Refresh token has been revoked");
        }
    }

    await userRepository.addRefreshToken({ userId, refreshToken });

    redisClient.set(`${hashRefreshToken(prevRefreshToken)}`, "revoked");
    redisClient.set(`${hashRefreshToken(refreshToken)}`, "active");

    return { accessToken, newRefreshToken: refreshToken };
}

export async function logout(userId, accessToken) {
    redisClient.set(accessToken, "revoked");
    const user = await userRepository.findById(userId);
    if (!user) throw notFound("User not found");
    const [refreshToken] = await userRepository.getRefreshTokenByUserId(userId);
    if (!refreshToken) throw notFound("Refresh token not found");

    redisClient.set(`${hashRefreshToken(refreshToken.tokenHash)}`, "revoked");
    await userRepository.revokeRefreshTokenForUser(userId);
}

// Current-user profile for GET /me (id comes from the verified access token).
export async function getMe(userId) {
    const user = await userRepository.findActiveById(userId);
    if (!user) throw notFound("User not found");
    return toMe(user);
}




export async function revokeRefreshToken(userId) {
    await service.revokeRefreshToken(userId);
}
