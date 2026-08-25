import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { role } from "./enums/role.js";
import { classification }     from "./enums/classification.js";
import { status }     from "./enums/status.js";

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    username: text("username").notNull(),
      hashedPassword : text("hashed_password").notNull(),
    fullName: text("full_name").notNull(),
    role: role("role").notNull(),
    org: text("org").notNull(),
    badgeId: text("badge_id"),

    email: text("email").notNull(),
    clearance: classification("clearance").notNull(),
    jurisdiction: text("jurisdiction").notNull(),
    status: status("status").notNull(),
    mfaEnrolled: boolean("mfa_enrolled").notNull().default(false),
      mfaTempSecret : text("mfa_temp_secret"),
      mfaSecret: text("mfa_secret"),


    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("users_username_key").on(t.username),
    uniqueIndex("users_email_key").on(t.email),
    index("users_role_idx").on(t.role),
    index("users_org_idx").on(t.org),
    index("users_status_idx").on(t.status),
  ],
);
