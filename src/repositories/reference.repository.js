import { asc, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { orgs, jurisdictions, users } from "../db/schema/index.js";
import { cases } from "../db/schema/index.js";

// Shared CRUD for the two lookup tables (orgs, jurisdictions). Both tables have
// an identical shape (id, name, description, active, timestamps), so one
// parameterized repository backs both rather than duplicating the same
// queries twice.
function makeRepository(table, userColumn, caseColumn) {
  return {
    async list({ activeOnly = false } = {}) {
      const query = db.select().from(table).orderBy(asc(table.name));
      if (activeOnly) return query.where(eq(table.active, true));
      return query;
    },

    async findById(id) {
      const [row] = await db.select().from(table).where(eq(table.id, id)).limit(1);
      return row ?? null;
    },

    async findByName(name) {
      const [row] = await db.select().from(table).where(eq(table.name, name)).limit(1);
      return row ?? null;
    },

    async create(values) {
      const [row] = await db.insert(table).values(values).returning();
      return row;
    },

    async update(id, values) {
      const [row] = await db
        .update(table)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(table.id, id))
        .returning();
      return row ?? null;
    },

    async remove(id) {
      const [row] = await db.delete(table).where(eq(table.id, id)).returning();
      return row ?? null;
    },

    // Reference count on users/cases — used to block deletion of a value that's
    // still in use (see reference.service.js). Renaming is fine since users/cases
    // store the free-text name, not the row id, but that means a rename does NOT
    // retroactively update existing users/cases rows.
    async countUsages(name) {
      const userRows = userColumn ? await db.select().from(users).where(eq(userColumn, name)) : [];
      const caseRows = caseColumn ? await db.select().from(cases).where(eq(caseColumn, name)) : [];
      return userRows.length + caseRows.length;
    },
  };
}

export const orgRepository = makeRepository(orgs, users.org, null);
export const jurisdictionRepository = makeRepository(jurisdictions, users.jurisdiction, cases.jurisdiction);
