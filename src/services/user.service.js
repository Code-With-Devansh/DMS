// Auth/user business logic. Controllers stay thin (HTTP + cookies only) and call
// into here; this layer owns credential checks, MFA (TOTP) enrollment and
// verification, and JWT issuance, delegating all persistence to the repository.
//
// Token strings are returned to the controller, which is responsible for placing
// them in cookies — this module never touches `req`/`res`.
import bcrypt from "bcrypt";
import speakeasy from "speakeasy";
import qrcode from "qrcode";

import userRepository from "../repositories/user.repository.js";
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
  verifyMfaToken,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from "../lib/tokens.js";

const TOTP_OPTS = { encoding: "base32", window: 1 }; // ±1 step (~30s) clock drift

// Login stages returned to the controller so it can shape the JSON response.
export const Stage = {
  MFA_REQUIRED: "MFA_REQUIRED", // enrolled user — verify a TOTP code
  MFA_ENROLLMENT_REQUIRED: "MFA_ENROLLMENT_REQUIRED", // first login — set MFA up
};

// Mint the access (15m) + refresh (1d) pair for an authenticated user.
function issueTokens(user) {
  const accessToken = signAccessToken({
    sub: user.id,
    username: user.username,
    role: user.role,
  });
  const refreshToken = signRefreshToken({ sub: user.id });
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
  const user = await userRepository.findUserById(payload.sub);
  if (!user) throw notFound("User not found");
  return user;
}

// Step 1 of login: validate credentials and hand back a short-lived MFA token
// (no access/refresh yet — those are only issued once MFA succeeds).
export async function login({ username, password }) {
  const user = await userRepository.findUserByUsername(username);

  // Compare against the stored hash. Note: bcrypt.compare is async — the previous
  // implementation forgot to await it, so every password "passed". Fixed here.
  const passwordValid =
    !!user && (await bcrypt.compare(password, user.hashedPassword));
  if (!passwordValid) throw invalidCredentials();

  if (user.status !== "ACTIVE") throw forbidden("Account is not active");

  const mfaToken = signMfaToken({ sub: user.id, username: user.username });
  const stage = user.mfaEnrolled
    ? Stage.MFA_REQUIRED
    : Stage.MFA_ENROLLMENT_REQUIRED;

  return { stage, mfaToken };
}

// Begin first-time MFA enrollment: generate a TOTP secret + QR for the
// authenticator app and stash the secret as pending on the user.
export async function startEnrollment(mfaToken) {
  const user = await resolveMfaUser(mfaToken);

  const secret = speakeasy.generateSecret({
    name: `DMS (${user.username})`,
    issuer: "DMS",
  });

  await userRepository.updateUserMfaTempSecret(user.id, secret.base32);

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

  await userRepository.updateUserSecret(user.id, user.mfaTempSecret);

  const backupCodes = generateBackupCodes(8);
  await userRepository.saveBackupCodes(user.id, backupCodes);

  const freshUser = await userRepository.findUserById(user.id);
  return { backupCodes, user: toMe(freshUser), ...issueTokens(freshUser) };
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

  const freshUser = await userRepository.findUserById(user.id);
  return { user: toMe(freshUser), ...issueTokens(freshUser) };
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

  const user = await userRepository.findUserById(payload.sub);
  if (!user) throw unauthenticated("User no longer exists");
  if (user.status !== "ACTIVE") throw forbidden("Account is not active");

  const accessToken = signAccessToken({
    sub: user.id,
    username: user.username,
    role: user.role,
  });
  return { accessToken };
}

// Current-user profile for GET /me (id comes from the verified access token).
export async function getMe(userId) {
  const user = await userRepository.findUserById(userId);
  if (!user) throw notFound("User not found");
  return toMe(user);
}
