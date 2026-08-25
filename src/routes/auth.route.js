import express from "express";
import speakeasy from "speakeasy";
import qrcode from "qrcode";
import { parse } from '../lib/validate.js';
import userRepository from "../repositories/user.repository.js";
import { loginSchema, mfaCodeSchema } from "../validation/schema/auth.schema.js";
import { toMe } from "../mapper/user.mapper.js";
import bcrypt from "bcrypt";
import {
    invalidCredentials,
    forbidden,
    notFound,
    badRequest,
    unauthenticated
} from "../lib/errors.js";

import { generateBackupCodes } from "../utils/generateBackupCodes.js"

const router = express.Router();


router.post("/login", async (req, res) => {

    let loginData = await parse(loginSchema, req.body);

    const { username, password } = loginData;
    const user = await userRepository.findUserByUsername(username);
    console.log(user);
    if (!user || !bcrypt.compare(password, user.hashedPassword)) {
        return invalidCredentials()
    }

    if (user.status !== "ACTIVE") {
        return forbidden("Forbidden");
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
        return notFound("Username is required");
    }

    const user = await userRepository.findUserByUsername(username);
    if (!user) {
        return notFound("User not found");
    }

    const secret = speakeasy.generateSecret({
        name: `DMS (${user.username})`,
        issuer: "DMS",
    });

    await userRepository.updateUserMfaTempSecret(user.id, secret.base32);


    const qrDataUrl = await qrcode.toDataURL(secret.otpauth_url);
    return res.status(200).json({
        secret: secret.base32,
        otpAuthUrl: secret.otpauth_url,
        qrDataUrl,
    });
});


// Route to verify the first token and finalize setup
router.post('/mfa/enroll/verify', async (req, res) => {
    const safeMFACode = await parse(mfaCodeSchema, req.body);
    const { code } = safeMFACode;
    const username = req.cookies.username;
    if (!username) {
        return notFound(`Username not found.`);
    }
    const user = await userRepository.findUserByUsername(username);
    if (!user || !user.mfaTempSecret) {
        return badRequest("No pending MFA enrollment found");
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
      await userRepository.updateUserSecret(user.id, user.mfaTempSecret);
      res.clearCookie("username");
        let backUpCodes = generateBackupCodes(8)
      await userRepository.saveBackupCodes(user.id, backUpCodes);
        return res.status(200).json({
            backUpCodes: backUpCodes,
        });
  }
    return badRequest("Invalid MFA code");
});

router.post('/mfa/verify',  async (req, res) => {
    const { code } = req.body;
    const username = req.cookies.username;
    if (!username) {
        return invalidCredentials("Username is required");
    }
    const user = await userRepository.findUserByUsername(username);
    if (!user || !user.mfaSecret || !user.mfaEnrolled) {
        return badRequest("User is not enrolled in MFA");
    }

    const verified = speakeasy.totp.verify({
        secret: user.mfaSecret,
        encoding: 'base32',
        token: code,
        window: 1,
    });

    if (!verified) {
        return unauthenticated("Invalid MFA code");
    }

    await userRepository.updateLastLoginAt(user.id);
    res.clearCookie("username");

    const freshUser = await userRepository.findUserById(user.id);
    return res.status(200).json({ user: toMe(freshUser) });
});

router.post("/logout", (req, res) => {
    return res.send({
        "message" : "Logout",
        "status" : 204
    });
});

router.get("/me", async (req, res) => {
    const user = await userRepository.findUserByUsername(req.cookies.username);
    return res.send({
        "message" : toMe(user),
        "status" : 200
    });
});

export default router;
