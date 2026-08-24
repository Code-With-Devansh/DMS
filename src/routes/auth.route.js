import express from "express";
import speakeasy from "speakeasy";
import qrcode from "qrcode";



const router = express.Router();


router.post("/login", async (req, res) => {
    console.log("Logging user")
    console.log(req.body)
    const { username, password } = req.body;

    if (!username || !password) {
        res.send({
            "status": "",
            "message": "Username or password can't be empty."
        });
    }


    console.log(username, password);

    // 1. Generate a new temporary secret key
    const secret = speakeasy.generateSecret({
        name: `DMS (${userDatabase.username})`
    });

    // 2. Temporarily save secret to the user profile (Do not mark enabled yet)
    userDatabase.mfaSecret = secret.base32;

    try {
        // 3. Convert the otpauth URL into a QR code data URL
        const qrCodeImageUrl = await qrcode.toDataURL(secret.otpauth_url);

        // 4. Send the QR code to the frontend
        res.json({
            qrCode: qrCodeImageUrl,
            secret: secret.base32 // Optional fallback for manual typing
        });
    } catch (error) {
        res.status(500).json({ error: "Failed to generate QR Code" });
    }


    res.send("Hello world")
});


// Route to verify the first token and finalize setup
router.post('/mfa/verify', (req, res) => {
  const { token } = req.body; // 6-digit code from user

  // Retrieve user's secret from your database
  const userSecret = userDatabase.mfaSecret;

  // Verify the token against the secret
  const verified = speakeasy.totp.verify({
    secret: userSecret,
    encoding: 'base32',
    token: token,
    window: 1 // Allows 30-second clock drift tolerance
  });

  if (verified) {
    // Commit to database that MFA is active
    userDatabase.isMfaEnabled = true;
    res.json({ success: true, message: "MFA enabled successfully" });
  } else {
    res.status(400).json({ success: false, message: "Invalid code. Try again." });
  }
});

router.post("/logout", (req, res) => {
    console.log("Logging out user.");
})

router.get("/me", (req, res) => {
    console.log(userDatabase);
    console.log("Hello, user");

    res.send("Hello")
});

export default router;
