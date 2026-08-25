// Centralized cookie names + options for the auth token cookies. Keeping set and
// clear in one place guarantees the options match — `res.clearCookie` only
// removes a cookie when its name/path/flags line up with how it was set.
import config from "../config/index.js";

export const AUTH_COOKIES = {
  access: "access_token",
  refresh: "refresh_token",
  mfa: "mfa_token",
};

// The access token is needed by every protected route, so it lives at "/".
const ACCESS_PATH = "/";
// The refresh and mfa tokens are only ever consumed by the auth router, so we
// scope them to it — the browser won't attach them to document/audit requests.
const REFRESH_PATH = "/api/auth";
const MFA_PATH = "/api/auth";

// httpOnly keeps tokens out of reach of client-side JS (XSS mitigation);
// secure/sameSite come from config so they can be tightened in production.
function baseOptions() {
  return {
    httpOnly: true,
    secure: config.cookie.secure,
    sameSite: config.cookie.sameSite,
  };
}


export function clearAuthCookies(res) {
  res.clearCookie(AUTH_COOKIES.access, { ...baseOptions(), path: ACCESS_PATH });
  res.clearCookie(AUTH_COOKIES.refresh, { ...baseOptions(), path: REFRESH_PATH });
}

export function setMfaCookie(res, token) {
  res.cookie(AUTH_COOKIES.mfa, token, {
    ...baseOptions(),
    path: MFA_PATH,
    maxAge: config.jwt.mfaMaxAgeMs,
  });
}

export function clearMfaCookie(res) {
  res.clearCookie(AUTH_COOKIES.mfa, { ...baseOptions(), path: MFA_PATH });
}
