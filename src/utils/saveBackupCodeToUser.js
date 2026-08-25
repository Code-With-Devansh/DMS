
import bcrypt from "bcrypt";
import {db} from "../db/index.js";

async function saveBackupCodesToUser(userId, rawCodes) {
    const saltRounds = 10;

    // Hash every generated code
    const hashedCodes = await Promise.all(
        rawCodes.map(async (code) => {
            const hash = await bcrypt.hash(code, saltRounds);
            return { codeHash: hash, used: false };
        })
    );

    // Update your database user record (example using a generic DB client)
    await db.user.update(userId, {
        backupCodes: hashedCodes
    });
}

