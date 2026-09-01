import crypto from "crypto";

function hashActivationToken(token) {
    return crypto.createHash("sha256").update(token).digest("hex");
}

export { hashActivationToken };
