import config from "../config/index.js";
import { createInMemoryLedgerService } from "./inMemoryLedger.js";

// App-wide LedgerService singleton. Import { ledger } from here in the anchor
// worker (and, later, custody/seal/verify handlers); nothing else should
// construct a ledger client directly. The driver is chosen once at boot from
// config.ledger.driver so swapping the in-memory stub for the real Fabric client
// is an env change, not a code change.

/** @returns {import("./types.js").LedgerService} */
function buildLedger() {
  switch (config.ledger.driver) {
    case "memory":
      return createInMemoryLedgerService({ mode: config.ledger.stubMode });
    case "fabric":
      // FabricLedgerService (real @hyperledger/fabric-gateway client, wallet,
      // connection profile) drops in here behind LEDGER_DRIVER=fabric.
      throw new Error('LEDGER_DRIVER="fabric" is not implemented yet; use "memory"');
    default:
      throw new Error(`unknown LEDGER_DRIVER: ${config.ledger.driver}`);
  }
}

export const ledger = buildLedger();
