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
    app: {
    env: process.env.NODE_ENV,
    port: Number(process.env.PORT),
  },
};
