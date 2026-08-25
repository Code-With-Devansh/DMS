import express from "express";
import speakeasy from "speakeasy";
import qrcode from "qrcode";
import { validate } from '../middleware/validate.js';
import {
    findUserById,
    findUserByUsername, updateLastLoginAt,
    updateUserMfaTempSecret,
    updateUserSecret
} from "../repository/user.repository.js";
import { loginSchema, mfaCodeSchema } from "../validation/schema/auth.schema.js";
import { toMe } from "../mapper/user.mapper.js";
import { apiError  } from "../dto/error.js";
import bcrypt from "bcrypt";

const router = express.Router();


router.post("/login", validate(loginSchema), async (req, res) => {

    const { username, password } = req.body;

    const user = await findUserByUsername(username);
    console.log(user);
    if (!user || !bcrypt.compare(password, user.hashedPassword)) {
        return apiError(res, 401,"Invalid username or password");
    }

    if (user.status !== "ACTIVE") {
        return apiError(res, 403, "User account is not active");
    }

    res.cookie(
        "username" , username, {
            maxAge: 15 * 60 * 1000, // Expires in 15 minutes (in milliseconds)
            httpOnly: true,  // Prevents client-side JS from reading the cookie
            secure: true,    // Requires HTTPS (use true in production)
            sameSite: 'strict'
        }
    )

    if (!user.mfaEnrolled) {
        return res.status(200).json({
            mfaRequired: false,
            mfaEnrollmentRequired: true,
            message: "First login detected. Complete MFA enrollment.",
        });
    }

    return res.status(200).json({ mfaRequired: true });
});


router.post("/mfa/enroll/start", async (req, res) => {
    const username = req.cookies.username;
    if(!username){
        return apiError(res, 401, "Username is required");
    }

    const user = await findUserByUsername(username);
    if (!user) {
        return apiError(res, 404,  "User not found");
    }

    const secret = speakeasy.generateSecret({
        name: `DMS (${user.username})`,
        issuer: "DMS",
    });

    await updateUserMfaTempSecret(user.id, secret.base32);


    const qrDataUrl = await qrcode.toDataURL(secret.otpauth_url);
    return res.status(200).json({
        secret: secret.base32,
        otpAuthUrl: secret.otpauth_url,
        qrDataUrl,
    });
});


// Route to verify the first token and finalize setup
router.post('/mfa/enroll/verify', validate(mfaCodeSchema), async (req, res) => {
    const { code } = req.body;
    const username = req.cookies.username;
    if (!username) {
        return apiError(res, 401, "Username is required");
    }
    const user = await findUserByUsername(username);
    if (!user || !user.mfaTempSecret) {
        return apiError(res, 400, "VALIDATION", "No pending MFA enrollment found");
    }

    console.log(user.mfaTempSecret);

  const verified = speakeasy.totp.verify({
        secret: user.mfaTempSecret,
    encoding: 'base32',
        token: code,
    window: 1 // Allows 30-second clock drift tolerance
  });

    console.log(verified);

  if (verified) {
      await updateUserSecret(user.id, user.mfaTempSecret);
      res.clearCookie("username");
        let backUpCodes = [
            "12345678`," +
            "12345698",
        ];
        return res.status(200).json({
            backUpCodes: backUpCodes,
        });
  }
    return apiError(res, 400, "VALIDATION", "Invalid MFA code");
});

router.post('/mfa/verify',validate(mfaCodeSchema),  async (req, res) => {
    const { code } = req.body;
    const username = req.cookies.username;
    if (!username) {
        return apiError(res, 401, "Username is required");
    }
    const user = await findUserByUsername(username);
    if (!user || !user.mfaSecret || !user.mfaEnrolled) {
        return apiError(res, 400,  "User is not enrolled in MFA");
    }

    const verified = speakeasy.totp.verify({
        secret: user.mfaSecret,
        encoding: 'base32',
        token: code,
        window: 1,
    });

    if (!verified) {
        return apiError(res, 401, "UNAUTHENTICATED", "Invalid MFA code");
    }

    await updateLastLoginAt(user.id);
    res.clearCookie("username");

    const freshUser = await findUserById(user.id);
    return res.status(200).json({ user: toMe(freshUser) });
});

router.post("/logout", (req, res) => {
    return res.send({
        "message" : "Logout",
        "status" : 204
    });
});

router.get("/me", async (req, res) => {
    const user = await findUserByUsername(req.cookies.username);
    return res.send({
        "message" : toMe(user),
        "status" : 200
    });
});

export default router;
