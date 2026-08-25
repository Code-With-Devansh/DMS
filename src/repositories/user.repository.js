
import { db } from "../db/index.js";

import { users } from "../db/schema/users.js";
import { eq } from "drizzle-orm";

import bcrypt from "bcrypt";


class UserRepository {

    async findUserByUsername(username) {
        const [user] = await db
            .select()
            .from(users)
            .where(eq(users.username, username))
            .limit(1);

        return user;
    }

    async findUserById(id) {
        const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
        return user;
    }


    async updateUserMfaTempSecret(id, secret) {
        await db
            .update(users)
            .set({mfaTempSecret: secret})
            .where(eq(users.id, id));
    }

    async updateUserSecret(id, secret) {
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
            .set({lastLoginAt: new Date()})
            .where(eq(users.id, id));
    }

    async saveBackupCodes(userId, rawCodes) {
        const saltRounds = 10;

        // Hash every generated code
        const hashedCodes = await Promise.all(
            rawCodes.map(async (code) => {
                const hash = await bcrypt.hash(code, saltRounds);
                return { codeHash: hash, used: false };
            })
        );

        console.log(hashedCodes);

        await db.
        update(users)
            .set({
                backupCodes: hashedCodes,
            });

        return hashedCodes;
    }
}

const userRepository = new UserRepository();

export default userRepository;
