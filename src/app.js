import express from 'express';
import authRouter from "./routes/auth.route.js"
import { storage } from "./storage/index.js";

const app = express();
const port = 3000;

app.use(express.json());


app.get('/', (req, res) => {
  res.send('Hello World!');
});


app.use("/api/auth", authRouter)

// Liveness + storage reachability (handy for a compose healthcheck).
app.get("/health/storage", async (req, res) => {
  try {
    await storage.ping();
    res.json({ storage: "ok", bucket: storage.bucket });
  } catch (err) {
    res.status(503).json({ storage: "unavailable", error: err.message });
  }
});

async function start() {
  // Make sure the documents bucket exists before serving (retries a cold MinIO).
  await storage.ensureBucket();
  app.listen(port, () => {
    console.log(`Example app listening on port ${port}`);
  });
}

start().catch((err) => {
  console.error("[startup] failed to start:", err);
  process.exit(1);
});