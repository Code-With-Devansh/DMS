import express from 'express';
import authRouter from "./routes/auth.route.js"
import cookieParser from 'cookie-parser';

import documentsRouter from "./routes/documents.route.js";
import auditRouter from "./routes/audit.route.js";
import caseRouter from "./routes/cases.route.js";
import usersRouter from "./routes/users.route.js";
import governanceRouter from "./routes/governance.route.js";

import { storage } from "./storage/index.js";
import { errorHandler } from "./middlewares/error.js";

const app = express();
const port = 3000;

app.use(express.json());
app.use(cookieParser());


app.get('/', (req, res) => {
  res.send('Hello World!');
});


app.use("/api/v1", authRouter);
app.use("/api/v1", caseRouter);

app.use("/api/v1", documentsRouter);
app.use("/api/v1", auditRouter);
app.use("/api/v1", usersRouter);
app.use("/api/v1", governanceRouter);

// Liveness + storage reachability (handy for a compose healthcheck).
app.get("/health/storage", async (req, res) => {
  try {
    await storage.ping();
    res.json({ storage: "ok", bucket: storage.bucket });
  } catch (err) {
    res.status(503).json({ storage: "unavailable", error: err.message });
  }
});

// Error handler must be registered last so it catches errors from every route
// above (Express 5 forwards rejected async handlers here automatically).
app.use(errorHandler);

async function start() {
  // Make sure the documents bucket exists before serving (retries a cold MinIO).
  await storage.ensureBucket();
  app.listen(port, () => {
    console.log(`DMS app listening on port ${port}`);
  });
}

start().catch((err) => {
  console.error("[startup] failed to start:", err);
  process.exit(1);
});