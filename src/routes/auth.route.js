// Auth routes. Kept thin: each path maps straight to a controller handler, with
// the shared requireAuth guard on the one endpoint that needs an authenticated
// caller. All logic lives in controllers/auth.controller.js and services/user.service.js.
import express from "express";
import * as ctrl from "../controllers/auth.controller.js";
import { requireAuth } from "../middlewares/auth.js";

const router = express.Router();

// Login + MFA handshake
router.post("/login", ctrl.login);
router.post("/mfa/enroll/start", ctrl.startEnrollment);
router.post("/mfa/enroll/verify", ctrl.verifyEnrollment);
router.post("/mfa/verify", ctrl.verifyLogin);

// Session lifecycle
router.post("/refresh", ctrl.refresh);
router.post("/logout", ctrl.logout);

// Current user (requires a valid access token)
router.get("/me", requireAuth, ctrl.me);

export default router;
