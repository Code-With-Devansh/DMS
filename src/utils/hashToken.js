import crypto from "crypto";

function hashRefreshToken(token) {
    return crypto.createHash("sha256").update(token).digest("hex");
}

function hashActivationToken(token) {
    return crypto.createHash("sha256").update(token).digest("hex");
}

function hashAccessToken(token) {
    return crypto.createHash("sha256").update(token).digest("hex");
}

export { hashRefreshToken, hashActivationToken, hashAccessToken }; 


