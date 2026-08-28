
import { db } from "../db/index.js";

import { users } from "../db/schema/users.js";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";

import argon2 from "argon2";


class UserRepository {

    async list({ role, org, status, q, page, pageSize }) {
        const filters = [];
        if (role) filters.push(eq(users.role, role));
        if (org) filters.push(eq(users.org, org));
        if (status) filters.push(eq(users.status, status));
        if (q) {
            const query = `%${q}%`;
            filters.push(or(ilike(users.fullName, query), ilike(users.email, query), ilike(users.username, query)));
        }

        const where = filters.length ? and(...filters) : undefined;
        const [items, [{ total }]] = await Promise.all([
            db.select().from(users).where(where).orderBy(desc(users.createdAt)).limit(pageSize).offset((page - 1) * pageSize),
            db.select({ total: sql`count(*)`.mapWith(Number) }).from(users).where(where),
        ]);

        return { items, total };
    }

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

    async findByEmail(email) {
        const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
        return user;
    }

    async create(data) {
        const [user] = await db.insert(users).values(data).returning();
        return user;
    }

    async update(id, data) {
        const [user] = await db.update(users).set(data).where(eq(users.id, id)).returning();
        return user;
    }

    async resetMfa(id) {
        await db.update(users).set({ mfaEnrolled: false, mfaSecret: null, mfaTempSecret: null, backupCodes: null }).where(eq(users.id, id));
    }


}

const userRepository = new UserRepository();
export default userRepository;
