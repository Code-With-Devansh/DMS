#!/usr/bin/env node
// Run from the app VM after deploying, to confirm the ClamAV VM is reachable
// and the OCI network security rules are correct — before trusting it in the
// actual pipeline. Uses the same zPING/PONG probe as
// src/processing/clamav.js#ping(), just standalone with no worker to boot.
//
//   node scripts/check-clamav.js
//   node scripts/check-clamav.js --host 10.0.1.20 --port 3310
//
// Reads CLAMAV_HOST/CLAMAV_PORT from the environment (same as the app) if
// --host/--port aren't given.
import { createClamAvScanner } from "../src/processing/clamav.js";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : fallback;
}

const host = arg("host", process.env.CLAMAV_HOST);
const port = Number(arg("port", process.env.CLAMAV_PORT || 3310));
const timeoutMs = Number(arg("timeout", process.env.CLAMAV_TIMEOUT_MS || 5000));

if (!host) {
  console.error("No host given. Pass --host <ip> or set CLAMAV_HOST.");
  process.exit(2);
}

console.log(`Pinging clamd at ${host}:${port} (timeout ${timeoutMs}ms)...`);

const scanner = createClamAvScanner({ host, port, timeoutMs });

try {
  const ok = await scanner.ping();
  if (ok) {
    console.log("OK — clamd responded PONG. Network path + clamd are both up.");
    process.exit(0);
  }
  console.error("clamd responded, but not with PONG — unexpected. Check the clamd version/config.");
  process.exit(1);
} catch (err) {
  console.error(`FAILED to reach clamd: ${err.message}`);
  console.error(
    "Check: is the clamav VM up (`docker compose -f docker-compose.clamav.yml ps`)? " +
      "Is the OCI NSG/Security List allowing TCP 3310 from this VM's private IP? " +
      "Is CLAMAV_HOST set to the clamav VM's PRIVATE IP (not a public one)?",
  );
  process.exit(1);
}
