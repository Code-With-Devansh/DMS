// Route guard: authenticate a request from the access-token cookie and attach
// req.user for downstream handlers (e.g. GET /me). Mirrors the shape produced by
// middlewares/currentUser.js so it can supersede that dev shim on protected routes.
import { verifyAccessToken } from "../lib/tokens.js";
import { unauthenticated } from "../lib/errors.js";

export function requireAuth(req, res, next) {
  const authorizationHeader = req.headers.authorization;
  const token = authorizationHeader.split(" ")[1];
  console.log(token);
  console.log(authorizationHeader);
  if (!token) return next(unauthenticated("Authentication required"));

  try {
    const payload = verifyAccessToken(token);
    req.user = {
      id: payload.sub,
      username: payload.username,
      role: payload.role,
    };
    return next();
  } catch {
    return next(unauthenticated("Access token invalid or expired"));
  }
}
