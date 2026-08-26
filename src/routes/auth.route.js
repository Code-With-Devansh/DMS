import express from "express";
import * as ctrl from "../controllers/auth.controller.js";
import { requireAuth } from "../middlewares/auth.js";
import argon2 from "argon2";

const router = express.Router();

// Login + MFA handshake
router.post("/login", ctrl.login);
router.post("/password", ctrl.passwordReset);
router.post("/mfa/enroll/start", ctrl.startEnrollment);
router.post("/mfa/enroll/verify", ctrl.verifyEnrollment);
router.post("/mfa/verify", ctrl.verifyLogin);
router.post("/step-up", requireAuth, ctrl.stepUp);

// Session lifecycle
router.post("/refresh", ctrl.refresh);
router.post("/logout", ctrl.logout);

// Current user (requires a valid access token)
router.get("/me", requireAuth, ctrl.me);

// utility end point not for production.
router.post("/hash", async (req, res) => {
    const { password } = req.body;
    const hashedPassword = await argon2.hash(password);
    return res.send({ "passwordHash": hashedPassword });
})

export default router;
