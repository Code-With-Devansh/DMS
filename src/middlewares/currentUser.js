import config from "../config/index.js";

// Temporary identity shim. When the real /auth middleware lands and sets
// req.user, this becomes a no-op passthrough. Until then it injects a dev user
// so createdBy (NOT NULL) is populated.
//
// NOT a security control — it authenticates nobody. Real access is enforced by
// the PDP/ABAC layer (see lib/authorize.js, DESIGN §6).
export function currentUser(req, res, next) {
  if (!req.user) {
    req.user = { id: config.dev.userId };
  }
  next();
}
