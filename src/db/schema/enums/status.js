
import {pgEnum} from "drizzle-orm/pg-core";

export const status = pgEnum(
    "status", [
        "ACTIVE",
        "DISABLED"
    ]
)