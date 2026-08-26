import crypto from "crypto";

// here we can't use argon2 because we need to be able to verify the token hash without having the original token. Instead, we use a SHA-256 hash for the refresh token, which is fast and secure enough for this purpose.
async function hashRefreshToken(token) {
    return crypto.createHash("sha256").update(token).digest("hex");
}

export { hashRefreshToken };
