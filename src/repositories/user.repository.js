
import { db } from "../db/index.js";

import { users } from "../db/schema/users.js";
import { eq } from "drizzle-orm";

import argon2 from "argon2";


class UserRepository {

    async findByUsername(username) {
        const [user] = await db
            .select()
            .from(users)
            .where(eq(users.username, username))
            .limit(1);

        return user;
    }

    async findById(id) {
        const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
        return user;
    }


    async updateMfaTempSecret(id, secret) {
        await db
            .update(users)
            .set({ mfaTempSecret: secret })
            .where(eq(users.id, id));
    }

    async updateMfaSecret(id, secret) {
        await db
            .update(users)
            .set({
                mfaSecret: secret,
                mfaTempSecret: null,
                mfaEnrolled: true,
                lastLoginAt: new Date(),
            })
            .where(eq(users.id, id));
    }

    async updateLastLoginAt(id) {
        await db
            .update(users)
            .set({ lastLoginAt: new Date() })
            .where(eq(users.id, id));
    }

    async saveBackupCodes(id, rawCodes) {
        // Hash every generated code
        const hashedCodes = await Promise.all(
            rawCodes.map(async (code) => {
                const hash = await argon2.hash(code);
                return { codeHash: hash, used: false };
            })
        );

        // saving the hashed codes as a JSON string in the database

        const stringifiedCodes = JSON.stringify(hashedCodes);

        await db.
            update(users)
            .set({
                backupCodes: stringifiedCodes,
            })
            .where(eq(users.id, id));

        return hashedCodes;
    }

    async updatePassword(id, hashedPassword) {
        await db
            .update(users)
            .set({ hashedPassword, passwordChangedAt: new Date() })
            .where(eq(users.id, id));
    }
}

const userRepository = new UserRepository();
export default userRepository;
