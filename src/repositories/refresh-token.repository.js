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

    async revokeById(id, userId) {
        await db.update(refreshTokens).set({ revokedAt: new Date() }).where(and(eq(refreshTokens.id, id), eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
    }
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

        const revokedTokens = await db
            .select()
            .from(refreshTokens)
            .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));


        for(const token of revokedTokens) {
            await redisClient.set(`${token.tokenHash}`, "revoked");
        }


        await db
            .update(refreshTokens)
            .set({ revokedAt: new Date() })
            .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
    }

    async revokeAllForToken(token) {
        let refreshToken = await this.findByToken(token);
        while (refreshToken) {
            await redisClient.set(`${refreshToken.tokenHash}`, "revoked");
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
            await redisClient.set(`${refreshToken.tokenHash}`, "revoked");
        }
    }
}

export default new RefreshTokenRepository();