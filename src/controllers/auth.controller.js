import { parse } from "../lib/validate.js";
import { loginSchema, mfaCodeSchema, passwordSchema } from "../validation/auth.schema.js";
import * as service from "../services/user.service.js";
import {
  AUTH_COOKIES,
  setMfaCookie,
  clearMfaCookie,
  setRefreshCookie,
  clearAuthCookies,
} from "../lib/cookies.js";

import { notFound } from "../lib/errors.js";
import {redisClient} from "../config/redis.js";
import { hashRefreshToken } from "../utils/hashRefreshToken.js";




// POST /login — verify credentials, then stash a short-lived MFA token in a
// cookie
export async function login(req, res) {
  const loginData = parse(loginSchema, req.body);
  const { stage, mfaToken, userId } = await service.login(loginData);

  await service.revokeRefreshTokensForUser(userId);
  setMfaCookie(res, mfaToken);

  if (stage === service.Stage.PASSWORD_RESET_REQUIRED) {
    return res.status(200).json({
      mfaRequired: false,
      passwordChangeRequired: true,
      mfaEnrollmentRequired: true,
    });
  }

  if (stage === service.Stage.MFA_ENROLLMENT_REQUIRED) {
    return res.status(200).json({
      mfaRequired: false,
      mfaEnrollmentRequired: true,
    });
  }

  return res.status(200).json({ mfaRequired: true });
}

export async function passwordReset(req, res) {
  const passwordData = parse(passwordSchema, req.body);
  const mfaToken = req.cookies?.[AUTH_COOKIES.mfa];

  await service.changePassword(mfaToken, passwordData);
  return res.send({ "status": 204, "message": "Password changed successfully." });
}

// POST /mfa/enroll/start — return the TOTP secret + QR for the authenticator app.
export async function startEnrollment(req, res) {
  const mfaToken = req.cookies?.[AUTH_COOKIES.mfa];
  const data = await service.startEnrollment(mfaToken);
  return res.status(200).json(data);
}

// POST /mfa/enroll/verify — finish first-time enrollment. On success we clear the
// MFA cookie and issue the access + refresh cookies.
export async function verifyEnrollment(req, res) {
  const { code } = parse(mfaCodeSchema, req.body);
  const mfaToken = req.cookies?.[AUTH_COOKIES.mfa];

  const { backupCodes, user, accessToken, refreshToken } =
    await service.verifyEnrollment(mfaToken, code);

  clearMfaCookie(res);
  setRefreshCookie(res, refreshToken);
  return res.status(200).json({ backUpCodes: backupCodes, user, accessToken });
}

// POST /mfa/verify — regular-login MFA step. Same cookie handoff as enrollment:
// clear the MFA cookie, set access + refresh.
export async function verifyLogin(req, res) {
  const { code } = parse(mfaCodeSchema, req.body);
  const mfaToken = req.cookies?.[AUTH_COOKIES.mfa];

  const { user, accessToken, refreshToken } = await service.verifyLogin(
    mfaToken,
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

  const prevAccessToken = req.headers.authorization?.split(" ")[1];

  if (!prevAccessToken) {
    throw notFound("Access token not found in request headers");
  }

  
  const refreshToken = req.cookies?.[AUTH_COOKIES.refresh];

  if (!refreshToken) {
    throw notFound("Refresh token not found in request cookies");
  }

  const isRevoked = await redisClient.get(`${hashRefreshToken(refreshToken)}`);

  if(isRevoked) {
    await service.revokeRefreshToken(refreshToken);
    clearAuthCookies(res);
    throw notFound("Refresh token has been revoked");
  }

  const { accessToken, newRefreshToken } = await service.refresh(refreshToken);
  
  await redisClient.set(`${prevAccessToken}`, "revoked");
  setRefreshCookie(res, newRefreshToken);

  return res.status(200).json({ message: "Access token refreshed", accessToken });
}

// POST /logout — drop every auth cookie (access, refresh, and any stray MFA one).
export async function logout(req, res) {
  const accessToken = req.headers.authorization?.split(" ")[1];
  
  if (accessToken) {
    await redisClient.set(`${accessToken}`, "revoked");
  }

  await service.revokeRefreshToken(req.cookies?.[AUTH_COOKIES.refresh]);
  clearAuthCookies(res);
  clearMfaCookie(res);
  return res.send({
    status: 204,
    message: "Logged out successfully",
  });
}

// GET /me — current user; requireAuth has already populated req.user.
export async function me(req, res) {
  const user = await service.getMe(req.user.id);
  console.log("Current user:", user);
  return res.status(200).json({ user });
}
