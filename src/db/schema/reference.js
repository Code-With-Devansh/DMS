import { pgTable, uuid, text, boolean, timestamp, unique } from "drizzle-orm/pg-core";

// Reference/lookup tables for the two previously-free-text fields on users/cases:
// org (users.org, admin_pools.org) and jurisdiction (users.jurisdiction, cases.jurisdiction).
// Both are simple admin-managed lookups (RBAC-gated, not quorum-gated — see
// src/services/reference.service.js). `name` is the canonical value stored on
// users/cases; it stays a plain text FK-less column there (changing that would
// mean migrating existing free-text data), so `active` lets an admin retire a
// value without breaking historical rows that still reference it.

export const orgs = pgTable(
  "orgs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    description: text("description"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("orgs_name_key").on(t.name)],
);

export const jurisdictions = pgTable(
  "jurisdictions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    description: text("description"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("jurisdictions_name_key").on(t.name)],
);
