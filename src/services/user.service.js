import argon2 from "argon2";
import speakeasy from "speakeasy";
import qrcode from "qrcode";

import userRepository from "../repositories/user.repository.js";
import refreshTokenRepository from "../repositories/refresh-token.repository.js";
import { toMe } from "../mapper/user.mapper.js";
import { generateBackupCodes } from "../utils/generateBackupCodes.js";
import {
  invalidCredentials,
  forbidden,
  notFound,
  badRequest,
  unauthenticated,
} from "../lib/errors.js";
import {
  signMfaToken,
  signStepUpToken,
  verifyMfaToken,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  verifyStepUpToken,
} from "../lib/tokens.js";

const TOTP_OPTS = { encoding: "base32", window: 1 }; // ±1 step (~30s) clock drift

// Login stages returned to the controller so it can shape the JSON response.
export const Stage = {
  PASSWORD_RESET_REQUIRED: "PASSWORD_RESET_REQUIRED",
  MFA_REQUIRED: "MFA_REQUIRED", // enrolled user — verify a TOTP code
  MFA_ENROLLMENT_REQUIRED: "MFA_ENROLLMENT_REQUIRED", // first login — set MFA up
};

// Mint the access (15m) + refresh (1d) pair for an authenticated user.
async function issueTokens(user) {
  const accessToken = signAccessToken({
    sub: user.id,
    username: user.username,
    role: user.role,
  });
  const refreshToken = signRefreshToken({ sub: user.id });
  const refreshPayload = verifyRefreshToken(refreshToken);
  await refreshTokenRepository.create({
    token: refreshToken,
    userId: user.id,
    expiresAt: new Date(refreshPayload.exp * 1000),
  });
  return { accessToken, refreshToken };
}

// Resolve the user behind an MFA-pending token (the cookie set at /login).
// Throws 401 if the token is missing/invalid/expired so the client restarts login.
async function resolveMfaUser(mfaToken) {
  if (!mfaToken) throw unauthenticated("MFA session missing; please log in again");
  let payload;
  try {
    payload = verifyMfaToken(mfaToken);
  } catch {
    throw unauthenticated("MFA session invalid or expired; please log in again");
  }
  const user = await userRepository.findById(payload.sub);
  if (!user) throw notFound("User not found");
  return user;
}

async function resolveRefreshUser(refreshToken) {
  if (!refreshToken) throw unauthenticated("Refresh token missing");
  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  }
  catch {
    throw unauthenticated("Refresh token invalid or expired");
  }
  const storedToken = await refreshTokenRepository.findActiveByToken(refreshToken);
  if (!storedToken || storedToken.userId !== payload.sub) {
    throw unauthenticated("Refresh token revoked or unknown");
  }
  const user = await userRepository.findById(payload.sub);
  if (!user) throw unauthenticated("User no longer exists");
  return user;
}



// Step 1 of login: validate credentials and hand back a short-lived MFA token
// (no access/refresh yet — those are only issued once MFA succeeds).
export async function login({ username, password }) {
  const user = await userRepository.findByUsername(username);

  if (!user) throw invalidCredentials();

  const passwordValid = (await argon2.verify(user.hashedPassword, password));
  if (!passwordValid) throw invalidCredentials();

  if (user.status !== "ACTIVE") throw forbidden("Account is not active");

  const mfaToken = signMfaToken({ sub: user.id, username: user.username });
  const stage = user.mfaEnrolled
    ? Stage.MFA_REQUIRED
    : user.passwordChangedAt
      ? Stage.MFA_ENROLLMENT_REQUIRED
      : Stage.PASSWORD_RESET_REQUIRED;

  return { stage, mfaToken, userId: user.id };
}

export async function changePassword(mfaToken, { currentPassword, newPassword }) {
  const user = await resolveMfaUser(mfaToken);

  if (currentPassword === newPassword) {
    throw badRequest("New password cannot be the same as the current password.");
  }

  if (user.passwordChangedAt) {
    throw badRequest("Password change is not allowed.");
  }

  if (!await argon2.verify(user.hashedPassword, currentPassword)) {
    throw invalidCredentials();
  }

  await userRepository.updatePassword(user.id, await argon2.hash(newPassword));
}

// Begin first-time MFA enrollment: generate a TOTP secret + QR for the
// authenticator app and stash the secret as pending on the user.
export async function startEnrollment(mfaToken) {
  const user = await resolveMfaUser(mfaToken);

  const secret = speakeasy.generateSecret({
    name: `DMS (${user.username})`,
    issuer: "DMS",
  });

  await userRepository.updateMfaTempSecret(user.id, secret.base32);

  const qrDataUrl = await qrcode.toDataURL(secret.otpauth_url);
  return {
    secret: secret.base32,
    otpAuthUrl: secret.otpauth_url,
    qrDataUrl,
  };
}

// Finish first-time enrollment: verify the first code against the pending secret,
// promote it to the active secret, generate backup codes, and issue tokens.
export async function verifyEnrollment(mfaToken, code) {
  const user = await resolveMfaUser(mfaToken);
  if (!user.mfaTempSecret) throw badRequest("No pending MFA enrollment found");

  const verified = speakeasy.totp.verify({
    secret: user.mfaTempSecret,
    token: code,
    ...TOTP_OPTS,
  });
  if (!verified) throw badRequest("Invalid MFA code");

  await userRepository.updateMfaSecret(user.id, user.mfaTempSecret);

  const backupCodes = generateBackupCodes(8);
  await userRepository.saveBackupCodes(user.id, backupCodes);

  const freshUser = await userRepository.findById(user.id);
  return { backupCodes, user: toMe(freshUser), ...(await issueTokens(freshUser)) };
}

// Regular login MFA step: verify a code against the active secret and issue tokens.
export async function verifyLogin(mfaToken, code) {
  const user = await resolveMfaUser(mfaToken);
  if (!user.mfaSecret || !user.mfaEnrolled) {
    throw badRequest("User is not enrolled in MFA");
  }

  const verified = speakeasy.totp.verify({
    secret: user.mfaSecret,
    token: code,
    ...TOTP_OPTS,
  });
  if (!verified) throw unauthenticated("Invalid MFA code");

  await userRepository.updateLastLoginAt(user.id);

  const freshUser = await userRepository.findById(user.id);
  return { user: toMe(freshUser), ...(await issueTokens(freshUser)) };
}

export async function createStepUpToken(userId, code) {
  const user = await userRepository.findById(userId);
  if (!user || user.status !== "ACTIVE") {
    throw unauthenticated("User is not active");
  }
  if (!user.mfaSecret || !user.mfaEnrolled) {
    throw badRequest("User is not enrolled in MFA");
  }

  const verified = speakeasy.totp.verify({
    secret: user.mfaSecret,
    token: code,
    ...TOTP_OPTS,
  });
  if (!verified) throw unauthenticated("Invalid MFA code");

  const stepUpToken = signStepUpToken({ sub: user.id });
  const payload = verifyStepUpToken(stepUpToken);
  return {
    stepUpToken,
    expiresAt: new Date(payload.exp * 1000).toISOString(),
  };
}

// Exchange a valid refresh token for a fresh access token (refresh stays put).
export async function refresh(refreshToken) {
  if (!refreshToken) throw unauthenticated("Refresh token missing");
  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    throw unauthenticated("Refresh token invalid or expired");
  }

  const storedToken = await refreshTokenRepository.findActiveByToken(refreshToken);

  if (!storedToken || storedToken.userId !== payload.sub) {
    throw unauthenticated("Refresh token revoked or unknown");
  }

  const user = await userRepository.findById(payload.sub);
  if (!user) throw unauthenticated("User no longer exists");
  if (user.status !== "ACTIVE") throw forbidden("Account is not active");

  const accessToken = signAccessToken({
    sub: user.id,
    username: user.username,
    role: user.role,
  });

  const newRefreshToken = signRefreshToken({ sub: user.id });
  const refreshTokenExpiry = verifyRefreshToken(newRefreshToken).exp;

  const newRefreshTokenRecord = await refreshTokenRepository.create({
    token: newRefreshToken,
    userId: user.id,
    expiresAt: new Date(refreshTokenExpiry * 1000),
  });

  console.log("Revoking old refresh token and linking to new one:", storedToken.id, newRefreshTokenRecord.id);

  await refreshTokenRepository.revokeToken(refreshToken, newRefreshTokenRecord.id);

  return { accessToken, newRefreshToken };
}

export async function revokeRefreshToken(refreshToken) {
  if (!refreshToken) return;
  await refreshTokenRepository.revokeToken(refreshToken);
}

export async function revokeRefreshTokens(refreshToken) {
  if (!refreshToken) return;
  const storedToken = await refreshTokenRepository.findByToken(refreshToken);
  if (!storedToken) return;
  await refreshTokenRepository.revokeAllForUser(storedToken.userId);
}


export async function revokeRefreshTokensForUser(userId) {
  await refreshTokenRepository.revokeAllForUser(userId);
}

// Current-user profile for GET /me (id comes from the verified access token).
export async function getMe(userId) {
  const user = await userRepository.findById(userId);
  if (!user) throw notFound("User not found");
  return toMe(user);
}
