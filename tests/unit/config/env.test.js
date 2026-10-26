import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const envModuleUrl = new URL("../../../config/env.js", import.meta.url).href;

const runConfigImport = async (variables) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "clickmate-env-test-"));
  try {
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", `import(${JSON.stringify(envModuleUrl)}).then(({ config }) => console.log(JSON.stringify(config)))`],
      { cwd: directory, env: { PATH: process.env.PATH, ...variables }, encoding: "utf8" }
    );
    return result;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};

test("configuration loads required MongoDB URI and default values", async () => {
  const result = await runConfigImport({ MONGODB_URI: "mongodb://localhost/clickmate_test" });

  assert.equal(result.status, 0, result.stderr);
  const config = JSON.parse(result.stdout);
  assert.equal(config.mongoUri, "mongodb://localhost/clickmate_test");
  assert.equal(config.port, 5051);
  assert.equal(config.pythonBin, "python3");
  assert.equal(config.socketAdapterEnabled, true);
  assert.equal(config.rateLimitWindowMs, 900000);
  assert.equal(config.rateLimitMax, 300);
});

test("configuration parses comma-separated origins and numeric overrides", async () => {
  const result = await runConfigImport({
    MONGODB_URI: "mongodb://localhost/clickmate_test",
    CORS_ORIGIN: " https://one.example, https://two.example ",
    PORT: "6060",
    RATE_LIMIT_WINDOW_MS: "60000",
    RATE_LIMIT_MAX: "25",
  });

  assert.equal(result.status, 0, result.stderr);
  const config = JSON.parse(result.stdout);
  assert.deepEqual(config.allowedOrigins, ["https://one.example", "https://two.example"]);
  assert.equal(config.port, "6060");
  assert.equal(config.rateLimitWindowMs, 60000);
  assert.equal(config.rateLimitMax, 25);
});

test("configuration disables the socket adapter only for the false string", async () => {
  const result = await runConfigImport({
    MONGODB_URI: "mongodb://localhost/clickmate_test",
    SOCKET_ADAPTER_ENABLED: "false",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).socketAdapterEnabled, false);
});

test("configuration fails fast when MongoDB URI is missing", async () => {
  const result = await runConfigImport({});

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /MONGODB_URI environment variable is required/);
});
