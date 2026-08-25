
import { db } from "../db/index.js";

import { users } from "../db/schema/users.js";
import { eq } from "drizzle-orm";

export async function findUserByUsername(username) {
    const [user] = await db
        .select()
        .from(users)
        .where(eq(users.username, username))
        .limit(1);

    return user;
}

export async function findUserById(id) {
    const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return user;
}


export async function updateUserMfaTempSecret(id,secret) {
    await db
        .update(users)
        .set({ mfaTempSecret: secret })
        .where(eq(users.id, id));
}

export async function updateUserSecret(id,secret) {
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

export async function updateLastLoginAt(id) {
    await db
        .update(users)
    .set({ lastLoginAt: new Date() })
    .where(eq(users.id, id));
}