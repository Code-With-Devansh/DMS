// Parse a human-friendly duration ("15m", "1h", "1d", "500ms") into milliseconds.
// Falls back to `fallbackMs` when the value is missing or unparseable. Used to
// keep cookie `maxAge` in lockstep with the JWT `expiresIn` strings below.
function durationToMs(value, fallbackMs) {
  if (value == null || value === "") return fallbackMs;
  const match = String(value).trim().match(/^(\d+)\s*(ms|s|m|h|d)?$/i);
  if (!match) return fallbackMs;
  const amount = Number(match[1]);
  const unit = (match[2] || "ms").toLowerCase();
  const multipliers = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return amount * multipliers[unit];
}

// Derive BullMQ/ioredis connection settings. Prefer REDIS_URL (what
// docker-compose sets); fall back to the discrete REDIS_HOST/PORT/PASSWORD vars,
// then to the compose service defaults. Returned as a { host, port, password }
// object because BullMQ builds and owns its own redis client from these.
function redisConnection() {
  let host = process.env.REDIS_HOST || "redis";
  let port = Number(process.env.REDIS_PORT) || 6379;
  let password = process.env.REDIS_PASSWORD || undefined;
  const url = process.env.REDIS_URL;
  if (url) {
    try {
      const u = new URL(url);
      if (u.hostname) host = u.hostname;
      if (u.port) port = Number(u.port);
      // A password-only URL (redis://:pw@host) leaves username empty; decode any
      // percent-escapes so special characters survive.
      if (u.password) password = decodeURIComponent(u.password);
    } catch {
      // Malformed REDIS_URL: ignore it and use the discrete vars above.
    }
  }
  return { host, port, password };
}

export default {
  postgres: {
    url: process.env.DATABASE_URL,
    max: Number(process.env.DATABASE_POOL_MAX) || 10,
    idleTimeoutMillis: Number(process.env.DATABASE_IDLE_TIMEOUT_MS) || 30_000,
    connectionTimeoutMillis:
      Number(process.env.DATABASE_CONNECT_TIMEOUT_MS) || 10_000,
  },
  storage: {
    // Internal endpoint the API/workers use to reach object storage
    // (http://minio:9000 over the Docker network; the S3/gov-cloud URL in prod).
    endpoint: process.env.STORAGE_ENDPOINT,
    // Endpoint baked into presigned URLs handed to the browser. In dev the
    // browser can't resolve the "minio" service name, so this must be the
    // host-reachable URL (http://localhost:9000). Falls back to `endpoint`.
    publicEndpoint:
      process.env.STORAGE_PUBLIC_ENDPOINT || process.env.STORAGE_ENDPOINT,
    region: process.env.STORAGE_REGION || "us-east-1",
    bucket: process.env.STORAGE_BUCKET || "dms-documents",
    accessKeyId: process.env.STORAGE_ACCESS_KEY,
    secretAccessKey: process.env.STORAGE_SECRET_KEY,
    // MinIO and other S3-compatibles need path-style addressing
    // (http://host/bucket/key) rather than virtual-host style (bucket.host).
    forcePathStyle: (process.env.STORAGE_FORCE_PATH_STYLE || "true") !== "false",
    // Server-side encryption applied at rest on upload. "AES256" = SSE-S3;
    // set blank to disable. The EncryptionProvider seam swaps this for app-level
    // envelope encryption later without touching callers.
    sse: process.env.STORAGE_SSE ?? "AES256",
    // Default lifetime of presigned download URLs, in seconds.
    signedUrlTtlSeconds: Number(process.env.STORAGE_SIGNED_URL_TTL) || 300,
  },
  upload: {
    // Max multipart upload size. Parsed in memory for now (middlewares/upload.js).
    maxFileBytes: Number(process.env.UPLOAD_MAX_BYTES) || 52_428_800, // 50 MiB
  },
  dev: {
    // Fallback identity used by middlewares/currentUser.js until real auth lands.
    userId: process.env.DEV_USER_ID || "00000000-0000-0000-0000-000000000001",
  },
    app: {
    env: process.env.NODE_ENV,
    port: Number(process.env.PORT),
  },
  jwt: {
    // Three separate secrets so a leak of one token class can't forge another.
    accessSecret: process.env.JWT_ACCESS_SECRET,
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    // Short-lived token that carries the user between /login and MFA verification,
    // replacing the old plaintext `username` cookie.
    mfaSecret: process.env.JWT_MFA_SECRET,
    // expiresIn strings handed straight to jsonwebtoken.
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES || "15m",
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES || "1d",
    mfaExpiresIn: process.env.JWT_MFA_EXPIRES || "10m",
    // Matching cookie lifetimes in ms, derived from the same env values.
    accessMaxAgeMs: durationToMs(process.env.JWT_ACCESS_EXPIRES, 15 * 60 * 1000),
    refreshMaxAgeMs: durationToMs(process.env.JWT_REFRESH_EXPIRES, 24 * 60 * 60 * 1000),
    mfaMaxAgeMs: durationToMs(process.env.JWT_MFA_EXPIRES, 10 * 60 * 1000),
  },
  cookie: {
    // In dev the API is served over plain HTTP on localhost, where `secure: true`
    // cookies are silently dropped by browsers — so this defaults to false and
    // should be flipped to true (via env) in any HTTPS deployment.
    secure: (process.env.COOKIE_SECURE || "false") === "true",
    sameSite: process.env.COOKIE_SAMESITE || "strict",
  },
  redis: {
    // Kept for reference/logging; the object below is what BullMQ consumes.
    url: process.env.REDIS_URL,
    connection: redisConnection(),
  },
  ledger: {
    // Master switch. When false, uploads skip enqueue entirely (rows stay
    // PENDING_LEDGER) — for environments with no worker/Redis.
    enabled: (process.env.LEDGER_ENABLED || "true") !== "false",
    // Which LedgerService implementation to construct: "memory" (in-process stub)
    // or "fabric" (real chaincode client — not yet built).
    driver: process.env.LEDGER_DRIVER || "memory",
    queueName: process.env.LEDGER_QUEUE_NAME || "ledger-anchor",
    // Anchor-job retry policy (BullMQ exponential backoff).
    attempts: Number(process.env.LEDGER_ANCHOR_ATTEMPTS) || 5,
    backoffMs: Number(process.env.LEDGER_ANCHOR_BACKOFF_MS) || 5000,
    concurrency: Number(process.env.LEDGER_WORKER_CONCURRENCY) || 4,
    // InMemoryLedgerService knob: "fail" makes every write throw, to exercise the
    // retry -> FAILED path. Any other value = normal operation.
    stubMode: process.env.LEDGER_STUB_MODE || "ok",
  },
};
