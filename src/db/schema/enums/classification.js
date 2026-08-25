import {pgEnum} from "drizzle-orm/pg-core";


export const classification = pgEnum("classification", [
    "PUBLIC",
    "RESTRICTED",
    "CONFIDENTIAL",
    "SECRET",
]);
