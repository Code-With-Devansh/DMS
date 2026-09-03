import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db/index.js";
import { refreshTokens } from "../db/schema/refresh_tokens.js";

import  redisClient from "../config/redis.js";
import { hashRefreshToken } from "../utils/hashToken.js";



class RefreshTokenRepository {
    async findById(id) {
        const [refreshToken] = await db.select().from(refreshTokens).where(eq(refreshTokens.id, id)).limit(1);
        return refreshToken;
    }

    async listActiveForUser(userId) {
        return db.select({
            id: refreshTokens.id,
            createdAt: refreshTokens.createdAt,
            expiresAt: refreshTokens.expiresAt,
        }).from(refreshTokens).where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
    }

    async revokeById( userId) {
        await db.update(refreshTokens).set({ revokedAt: new Date() }).where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
    }
    async create({ token, userId, expiresAt }) {
        const [refreshToken] = await db
            .insert(refreshTokens)
            .values({
                userId,
                tokenHash: hashRefreshToken(token),
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
                    eq(refreshTokens.tokenHash, hashRefreshToken(token)),
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
            .where(eq(refreshTokens.tokenHash, hashRefreshToken(token)))
            .limit(1);
        return refreshToken;
    }


    async revokeToken(token) {
        const refreshToken = await this.findByToken(token);
        if (refreshToken) {
            await db
                .update(refreshTokens)
                .set({ revokedAt: new Date() })
                .where(eq(refreshTokens.id, refreshToken.id));
            await redisClient.set(`${refreshToken.tokenHash}`, "revoked");
        }
    }
}

export default new RefreshTokenRepository();