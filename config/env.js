import { existsSync, readFileSync } from "fs";

const loadLocalEnv = () => {
  if (!existsSync(".env")) return;

  const envFile = readFileSync(".env", "utf8");
  for (const line of envFile.split("\n")) {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith("#")) continue;

    const separatorIndex = trimmedLine.indexOf("=");
    if (separatorIndex === -1) continue;

    const key = trimmedLine.slice(0, separatorIndex).trim();
    const value = trimmedLine.slice(separatorIndex + 1).trim();
    if (key && process.env[key] === undefined) {
      process.env[key] = value.replace(/^["']|["']$/g, "");
    }
  }
};

loadLocalEnv();

const allowedOrigins = process.env.CORS_ORIGIN?.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

export const config = {
  port: process.env.PORT || 5051,
  mongoUri: process.env.MONGODB_URI,
  allowedOrigins: allowedOrigins?.length ? allowedOrigins : false,
  pythonBin: process.env.PYTHON_BIN || "python3",
  socketAdapterEnabled: process.env.SOCKET_ADAPTER_ENABLED !== "false",
  rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
  rateLimitMax: Number(process.env.RATE_LIMIT_MAX || 300),
};

if (!config.mongoUri) {
  throw new Error("MONGODB_URI environment variable is required");
}
