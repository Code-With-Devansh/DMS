import { pgEnum } from "drizzle-orm/pg-core";


export const role = pgEnum("role", [
    "INVESTIGATING_OFFICER",
    "SUPERVISOR",
    "PROSECUTOR",
    "JUDGE",
    "COURT_CLERK",
    "FORENSIC_ANALYST",
    "RECORDS_ADMIN",
    "SECURITY_ADMIN",
    "ORG_ADMIN",
    "SYSTEM_ADMIN",
    "AUDITOR"
])
