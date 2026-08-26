import { and, eq, isNull } from "drizzle-orm";
import crypto from "crypto";
import { db } from "../db/index.js";
import { refreshTokens } from "../db/schema/refresh_tokens.js";


// here we can't use argon2 because we need to be able to verify the token hash without having the original token. Instead, we use a SHA-256 hash for the refresh token, which is fast and secure enough for this purpose.
async function hashRefreshToken(token) {
    return crypto.createHash("sha256").update(token).digest("hex");
}

class RefreshTokenRepository {
    async create({ token, userId, expiresAt }) {
        const [refreshToken] = await db
            .insert(refreshTokens)
            .values({
                userId,
                tokenHash: await hashRefreshToken(token),
                expiresAt,
            })
            .returning({ id: refreshTokens.id });

        return refreshToken;
    }

    async findActiveByToken(token) {
        const [refreshToken] = await db
            .select()
            .from(refreshTokens)
            .where(
                and(
                    eq(refreshTokens.tokenHash, await hashRefreshToken(token)),
                    isNull(refreshTokens.revokedAt),
                ),
            )
            .limit(1);

        return refreshToken;
    }

    async findByToken(token) {
        const [refreshToken] = await db
            .select()
            .from(refreshTokens)
            .where(eq(refreshTokens.tokenHash, await hashRefreshToken(token)))
            .limit(1);
        return refreshToken;
    }

    async revokeAllForUser(userId) {
        await db
            .update(refreshTokens)
            .set({ revokedAt: new Date() })
            .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
    }

    async revokeAllForToken(token) {
        let refreshToken = await this.findByToken(token);
        while (refreshToken) {
            await db
                .update(refreshTokens)
                .set({ revokedAt: new Date(), newRefreshTokenId: refreshToken.newRefreshTokenId })
                .where(eq(refreshTokens.id, refreshToken.id));

            const nextToken = await db
                .select()
                .from(refreshTokens)
                .where(eq(refreshTokens.id, refreshToken.newRefreshTokenId))
                .limit(1);

            refreshToken = nextToken[0];
        }
    }

    async revokeToken(token, newRefreshTokenId = null) {
        const refreshToken = await this.findByToken(token);
        if (refreshToken) {
            await db
                .update(refreshTokens)
                .set({ revokedAt: new Date(), newRefreshTokenId })
                .where(eq(refreshTokens.id, refreshToken.id));
        }
    }
}

export default new RefreshTokenRepository();