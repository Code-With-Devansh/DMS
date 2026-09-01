import { parse } from "../lib/validate.js";
import { loginSchema, mfaCodeSchema, changePasswordSchema, activateAccountSchema } from "../validation/auth.schema.js";
import * as service from "../services/auth.service.js";
import {
    AUTH_COOKIES,
    clearMfaCookie,
    setRefreshCookie,
    clearAuthCookies, setMfaCookie,
} from "../lib/cookies.js";

import { notFound, badRequest } from "../lib/errors.js";
import redisClient from "../config/redis.js";
import { hashRefreshToken, hashAccessToken } from "../utils/hashToken.js";
import { getAccessExpiryTime, getUserIdFromMfaToken, getUserIdFromRefreshToken } from "../lib/tokens.js";


// POST /login — verify credentials, then stash a short-lived MFA token in a
// cookie
export async function login(req, res) {
    const loginData = parse(loginSchema, req.body);
    const { mfaRequired, mfaToken } = await service.login(loginData);
    setMfaCookie(res, mfaToken);
    clearAuthCookies(res);

    return res.status(200).json({ mfaRequired });
}

export async function changePassword(req, res) {
    const passwordData = parse(changePasswordSchema, req.body);

    const userId = req.user.id;
    if(!userId) {
        throw notFound("User ID not found in request");
    }

    await service.changePassword(userId, passwordData);
    return res.status(204).send();
}


export async function activateAccount(req, res) {
    const activateData = parse(activateAccountSchema, req.body);

    await service.activateAccount(activateData);
    return res.status(204).send();
}


// POST /mfa/enroll/start — return the TOTP secret + QR for the authenticator app.
export async function startMfaEnrollment(req, res) {
    const mfaToken = req.cookies?.[AUTH_COOKIES.mfa];
    if (!mfaToken) {
        throw badRequest("MFA token is required");
    }

    const userId = getUserIdFromMfaToken(mfaToken);
    if (!userId) {
        throw badRequest("Invalid MFA token");
    }

    const data = await service.startMfaEnrollment(userId);
    return res.status(200).json(data);
}

// POST /mfa/enroll/verify — finish first-time enrollment. On success, we clear the
// MFA cookie and issue the access + refresh cookies.
export async function verifyMfaEnrollment(req, res) {
    const { code } = parse(mfaCodeSchema, req.body);
    const mfaToken = req.cookies?.[AUTH_COOKIES.mfa];
    if (!mfaToken) {
        throw badRequest("MFA token is required");
    }

    const userId = getUserIdFromMfaToken(mfaToken);
    if (!userId) {
        throw badRequest("Invalid MFA token");
    }

    const { backupCodes, user, accessToken, refreshToken } = await service.verifyMfaEnrollment(userId, code);
    clearMfaCookie(res);
    setRefreshCookie(res, refreshToken);
    redisClient.set(`${hashRefreshToken(refreshToken)}`, "active");
    redisClient.set(`${hashAccessToken(accessToken)}`, "active");

    return res.status(200).json({ backUpCodes: backupCodes, user, accessToken });
}

// POST /mfa/verify — regular-login MFA step. Same cookie handoff as enrollment:
// clear the MFA cookie, set access + refresh.
export async function verifyMfa(req, res) {
    const { code } = parse(mfaCodeSchema, req.body);
    const mfaToken = req.cookies?.[AUTH_COOKIES.mfa];

    if (!mfaToken) throw badRequest("MFA token is required");

    const userId = getUserIdFromMfaToken(mfaToken);
    if (!userId) throw badRequest("Invalid MFA token");

    const { user, accessToken, refreshToken } = await service.verifyMfa(
        userId,
        code,
    );
    clearMfaCookie(res);
    setRefreshCookie(res, refreshToken);
    return res.status(200).json({ user, accessToken });
}

export async function stepUp(req, res) {
    const { code } = parse(mfaCodeSchema, req.body);
    const data = await service.createStepUpToken(req.user.id, code);
    return res.status(200).json(data);
}

// POST /refresh — mint a new access token from the refresh cookie.
export async function refresh(req, res) {
    const prevAccessToken = req.headers.authorization?.split(' ')[1];


    const refreshToken = req.cookies?.[AUTH_COOKIES.refresh];
    if (!refreshToken) {
        throw notFound("Refresh token not found in request cookies");
    }

    let userId;

    try {
        userId = getUserIdFromRefreshToken(refreshToken);
    } catch (error) {
        throw notFound("Invalid refresh token");
    }

    if (!userId) {
        throw notFound("Invalid refresh token");
    }

    const isRevoked = await redisClient.get(`${hashRefreshToken(refreshToken)}`);

    if (isRevoked == "revoked") {
        await service.revokeRefreshToken(userId);
        clearAuthCookies(res);
        clearMfaCookie(res);
        throw notFound("Refresh token has been revoked");
    }

    const { accessToken, newRefreshToken } = await service.refresh(userId, prevAccessToken, refreshToken);
    setRefreshCookie(res, newRefreshToken);

    return res.status(200).json({ message: "Access token refreshed", accessToken });
}

// POST /logout — drop every auth cookie (access, refresh, and any stray MFA one).
export async function logout(req, res) {
    const accessToken = req.headers.authorization?.split(" ")[1];
    const refreshToken = req.cookies?.[AUTH_COOKIES.refresh];


    
    if (accessToken) {
        await redisClient.set(`${hashAccessToken(accessToken)}`, "revoked", {
            "EX": Math.round((getAccessExpiryTime(accessToken) - Date.now() / 1000)),
        });
    }
    
    if (refreshToken) {
        const userId = getUserIdFromRefreshToken(refreshToken);
        if (!userId) {
            throw notFound("Refresh token is required");
        }
        await service.logout(userId, accessToken);
    }

    clearAuthCookies(res);
    clearMfaCookie(res);
    return res.status(204).send();
}

// GET /me — current user; requireAuth has already populated req.user.
export async function aboutUser(req, res) {
    const user = await service.getMe(req.user.id);
    return res.status(200).json({ user });
}


