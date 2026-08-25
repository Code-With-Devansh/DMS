// Thin HTTP layer for auth. Controllers validate input, translate the service's
// result into responses, and own all cookie reads/writes — the service returns
// plain data and token strings and never touches req/res.
import { parse } from "../lib/validate.js";
import { loginSchema, mfaCodeSchema } from "../validation/schema/auth.schema.js";
import * as service from "../services/user.service.js";
import {
  AUTH_COOKIES,
  setMfaCookie,
  clearMfaCookie,
} from "../lib/cookies.js";

// POST /login — verify credentials, then stash a short-lived MFA token in a
// cookie (this replaces the old plaintext `username` cookie).
export async function login(req, res) {
  const loginData = parse(loginSchema, req.body);
  const { stage, mfaToken } = await service.login(loginData);

  setMfaCookie(res, mfaToken);

  if (stage === service.Stage.MFA_ENROLLMENT_REQUIRED) {
    return res.status(200).json({
      mfaRequired: false,
      mfaEnrollmentRequired: true,
      message: "First login detected. Complete MFA enrollment.",
    });
  }
  return res.status(200).json({ mfaRequired: true });
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

  return res.status(200).json({ backUpCodes: backupCodes, user, accessToken, refreshToken });
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

  return res.status(200).json({ user, accessToken, refreshToken });
}

// POST /refresh — mint a new access token from the refresh cookie.
export async function refresh(req, res) {
  const refreshToken = req.cookies?.[AUTH_COOKIES.refresh];
  const { accessToken } = await service.refresh(refreshToken);

  return res.status(200).json({ message: "Access token refreshed", accessToken });
}

// POST /logout — drop every auth cookie (access, refresh, and any stray MFA one).
export async function logout(req, res) {
  return res.status(200).json({ message: "Logged out" });
}

// GET /me — current user; requireAuth has already populated req.user.
export async function me(req, res) {
  const user = await service.getMe(req.user.id);
  return res.status(200).json({ user });
}
