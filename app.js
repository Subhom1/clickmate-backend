import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import http from "http";
import { Server as SocketIo } from "socket.io";
import { config } from "./config/env.js";
import { connectDatabase, disconnectDatabase, isDatabaseReady } from "./config/database.js";
import { removeUploadedFiles } from "./middleware/upload.js";
import userRoutes from "./routes/userRoutes.js";
import contentRoutes from "./routes/contentRoutes.js";
import chatRoutes from "./routes/chatRoutes.js";
import { createSimilarityService } from "./services/similarityService.js";
import { createSearchService } from "./services/searchService.js";
import { registerSocketHandlers } from "./sockets/registerSocketHandlers.js";

const app = express();

app.use(helmet());
app.use(rateLimit({
  windowMs: config.rateLimitWindowMs,
  limit: config.rateLimitMax,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skip: (req) => req.path === "/health",
  message: { message: "Too many requests, please try again later" },
}));
app.use(express.json({ limit: "100kb" }));
app.use(express.static("./public"));
app.use(cors({ origin: config.allowedOrigins }));

const server = http.createServer(app);
const io = new SocketIo(server, { cors: { origin: config.allowedOrigins } });
const similarityService = createSimilarityService(config.pythonBin);
const searchService = createSearchService(io, similarityService);

app.use(userRoutes);
app.use(contentRoutes);
app.use(chatRoutes);
app.get("/health", (req, res) => {
  const databaseReady = isDatabaseReady();
  res.status(databaseReady ? 200 : 503).json({
    status: databaseReady ? "ok" : "degraded",
    database: databaseReady ? "connected" : "disconnected",
  });
});

registerSocketHandlers(io, searchService);

app.use(async (error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (req.files?.length) await removeUploadedFiles(req.files);
  console.error("Unhandled request error:", error);
  if (error.code?.startsWith?.("LIMIT_")) return res.status(400).json({ message: "Upload exceeds the allowed limits" });
  if (error.message?.includes("Only JPEG") || error.message?.includes("image type")) return res.status(400).json({ message: "Only valid JPEG, PNG, and GIF images are allowed" });
  res.status(error.statusCode || 500).json({ message: error.statusCode ? error.message : "Internal server error" });
});

const startServer = async () => {
  await connectDatabase(config.mongoUri, io, config.socketAdapterEnabled);
  await similarityService.start();
  console.log("Similarity worker ready");
  server.listen(config.port, () => console.log(`Server is running on port ${config.port}`));
};

startServer().catch((error) => {
  console.error("Unable to start backend:", error.message);
  process.exitCode = 1;
});

const shutdown = async (signal) => {
  console.log(`${signal} received, shutting down`);
  similarityService.stop();
  await new Promise((resolve) => server.close(resolve));
  await disconnectDatabase();
  process.exit(0);
};

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));

export default app;
