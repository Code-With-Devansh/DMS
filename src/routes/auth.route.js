import express from "express";
import * as ctrl from "../controllers/auth.controller.js";
import { requireAuth } from "../middlewares/auth.js";

const router = express.Router();

// Login + MFA handshake
router.post("/login", ctrl.login);
router.post("/password", ctrl.changePassword);
router.post("/mfa/enroll/start", ctrl.startMfaEnrollment);
router.post("/mfa/enroll/verify", ctrl.verifyMfaEnrollment);
router.post("/mfa/verify", ctrl.verifyMfa);
router.post("/step-up", requireAuth, ctrl.stepUp);

// Session lifecycle
router.post("/refresh", ctrl.refresh);
router.post("/logout",requireAuth, ctrl.logout);

// Current user (requires a valid access token)
router.get("/me", requireAuth, ctrl.aboutUser);


export default router;
