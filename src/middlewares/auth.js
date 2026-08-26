// Route guard: authenticate a request from the access-token cookie and attach
// req.user for downstream handlers (e.g. GET /me). Mirrors the shape produced by
// middlewares/currentUser.js so it can supersede that dev shim on protected routes.
import { verifyAccessToken } from "../lib/tokens.js";
import { unauthenticated } from "../lib/errors.js";
import redisClient from "../lib/redis.js";


export async function requireAuth(req, res, next) {
  // required auth missing header crash
  if( !req.headers.authorization ) {
    return next(unauthenticated("Authentication Required"));
  }

  const authorizationHeader = req.headers.authorization;
  const token = authorizationHeader.split(" ").at(1);
  if (!token) return next(unauthenticated("Authentication required"));

  const isRevoked = await redisClient.get(`${token}`);

  if(isRevoked) {
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
