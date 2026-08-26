// Route guard: authenticate a request from the `Authorization: Bearer` header and
// attach req.user for downstream handlers. Mirrors the shape produced by
// middlewares/currentUser.js so it can supersede that dev shim on protected routes.
import { verifyAccessToken, verifyStepUpToken } from "../lib/tokens.js";
import { stepUpRequired, unauthenticated } from "../lib/errors.js";
import redisClient from "../config/redis.js";


export async function requireAuth(req, res, next) {
  const authorizationHeader = req.headers.authorization;

  const [scheme, tokenFromHeader] = authorizationHeader?.trim().split(/\s+/) ?? [];
  if (authorizationHeader && scheme !== "Bearer") {
    return next(unauthenticated("Bearer authentication required"));
  }

  const token = tokenFromHeader;
  if (!token) return next(unauthenticated("Authentication required"));

  const isRevoked = await redisClient.get(`${token}`);

  if (isRevoked) {
    return next(unauthenticated("Access token has been revoked"));
  }


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

export function requireStepUp(req, res, next) {
  const token = req.headers["x-step-up-token"];
  if (!token) return next(stepUpRequired());

  try {
    const payload = verifyStepUpToken(token);
    if (payload.sub !== req.user?.id) return next(stepUpRequired());
    return next();
  } catch {
    return next(stepUpRequired("Step-up authentication is invalid or expired"));
  }
}
