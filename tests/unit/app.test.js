import test, { mock } from "node:test";
import assert from "node:assert/strict";
import * as realHttp from "node:http";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const calls = { connect: [], disconnect: 0, workerStarts: 0, workerStops: 0, removed: [], registered: 0, serverCloses: 0 };
let databaseReady = false;
let databaseError = null;
const config = {
  port: 5051,
  mongoUri: "mongodb://localhost/clickmate-test",
  allowedOrigins: false,
  pythonBin: "python3",
  socketAdapterEnabled: false,
  rateLimitWindowMs: 60_000,
  rateLimitMax: 5,
};
const databaseMock = {
  connectDatabase: async (...args) => { calls.connect.push(args); if (databaseError) throw databaseError; },
  disconnectDatabase: async () => { calls.disconnect++; },
  isDatabaseReady: () => databaseReady,
};
const uploadMock = { removeUploadedFiles: async (files) => { calls.removed.push(files); } };
const noopRouter = (_req, _res, next) => next();
const similarityMock = { createSimilarityService: () => ({ start: async () => { calls.workerStarts++; }, stop() { calls.workerStops++; } }) };
const searchMock = { createSearchService: () => ({}) };
const socketHandlersMock = { registerSocketHandlers: () => { calls.registered++; } };
const fakeServer = {
  listen(port, callback) { this.port = port; callback?.(); },
  close(callback) { calls.serverCloses++; callback?.(); },
};
const httpMock = { ...realHttp, createServer: () => fakeServer };
const fakeIo = { use() {}, on() {}, adapter() {} };
class FakeSocketIo { constructor() { return fakeIo; } }
const nodeMajorVersion = Number(process.versions.node.split(".")[0]);
const defaultMock = (value) => nodeMajorVersion >= 26 ? { exports: { default: value } } : { defaultExport: value };
const namedMock = (value) => nodeMajorVersion >= 26 ? { exports: value } : { namedExports: value };
mock.module(pathToFileURL(resolve(process.cwd(), "config/env.js")), namedMock({ config }));
mock.module(pathToFileURL(resolve(process.cwd(), "config/database.js")), namedMock(databaseMock));
mock.module(pathToFileURL(resolve(process.cwd(), "middleware/upload.js")), namedMock(uploadMock));
mock.module(pathToFileURL(resolve(process.cwd(), "routes/userRoutes.js")), defaultMock(noopRouter));
mock.module(pathToFileURL(resolve(process.cwd(), "routes/contentRoutes.js")), defaultMock(noopRouter));
mock.module(pathToFileURL(resolve(process.cwd(), "routes/chatRoutes.js")), defaultMock(noopRouter));
mock.module(pathToFileURL(resolve(process.cwd(), "services/similarityService.js")), namedMock(similarityMock));
mock.module(pathToFileURL(resolve(process.cwd(), "services/searchService.js")), namedMock(searchMock));
mock.module(pathToFileURL(resolve(process.cwd(), "sockets/registerSocketHandlers.js")), namedMock(socketHandlersMock));
mock.module("http", defaultMock(httpMock));
mock.module("socket.io", namedMock({ Server: FakeSocketIo }));

const originalProcessOnce = process.once;
const signalHandlers = [];
process.once = function (event, handler) { signalHandlers.push({ event, handler }); return this; };
let app;
try {
  ({ default: app } = await import(pathToFileURL(resolve(process.cwd(), "app.js"))));
} finally {
  process.once = originalProcessOnce;
}
const routeHandler = (path) => {
  const layer = app._router.stack.find((entry) => entry.route?.path === path);
  assert.ok(layer, `Expected route ${path}`);
  return layer.route.stack.at(-1).handle;
};
const errorHandler = app._router.stack.find((entry) => entry.handle.length === 4)?.handle;
assert.equal(typeof errorHandler, "function", "Expected the Express error handler");
const responseRecorder = (headersSent = false) => ({
  headersSent,
  statusCode: 200,
  payload: undefined,
  status(code) { this.statusCode = code; return this; },
  json(payload) { this.payload = payload; return this; },
});

test("app connects dependencies and starts listening after worker readiness", async () => {
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls.connect, [[config.mongoUri, fakeIo, false]]);
  assert.equal(calls.workerStarts, 1);
  assert.equal(fakeServer.port, config.port);
  assert.equal(calls.registered, 1);
});

test("app startup failure sets a failing process exit code without starting the worker", async () => {
  const originalExitCode = process.exitCode;
  const originalOnce = process.once;
  const originalError = console.error;
  const workerStartsBeforeFailure = calls.workerStarts;
  const startupError = new Error("database unavailable");
  databaseError = startupError;
  process.exitCode = 0;
  process.once = function () { return this; };
  console.error = () => {};
  try {
    const appUrl = pathToFileURL(resolve(process.cwd(), "app.js"));
    appUrl.searchParams.set("startup-failure", "database");
    await import(appUrl);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(process.exitCode, 1);
    assert.equal(calls.workerStarts, workerStartsBeforeFailure);
  } finally {
    process.exitCode = originalExitCode;
    process.once = originalOnce;
    console.error = originalError;
    databaseError = null;
  }
});

test("shutdown stops the worker, closes HTTP, disconnects MongoDB, and exits cleanly", async () => {
  const signal = signalHandlers.find((entry) => entry.event === "SIGTERM");
  assert.ok(signal);
  const originalExit = process.exit;
  const exited = new Promise((resolve) => { process.exit = (code) => resolve(code); });
  const originalLog = console.log;
  console.log = () => {};
  try {
    signal.handler();
    assert.equal(await exited, 0);
  } finally {
    process.exit = originalExit;
    console.log = originalLog;
  }
  assert.equal(calls.workerStops, 1);
  assert.equal(calls.serverCloses, 1);
  assert.equal(calls.disconnect, 1);
});

test("health reports ready when the database connection is open", () => {
  databaseReady = true;
  const res = responseRecorder();
  routeHandler("/health")({}, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload, { status: "ok", database: "connected" });
});

test("health reports degraded service while the database is unavailable", () => {
  databaseReady = false;
  const res = responseRecorder();
  routeHandler("/health")({}, res);
  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.payload, { status: "degraded", database: "disconnected" });
});

test("upload size errors remove partial files and return a client error", async () => {
  const files = [{ path: "/tmp/partial-upload" }];
  const res = responseRecorder();
  await invokeError({ code: "LIMIT_FILE_SIZE" }, { files }, res);
  assert.deepEqual(calls.removed.at(-1), files);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.payload, { message: "Upload exceeds the allowed limits" });
});

test("invalid image errors return the stable supported-image message", async () => {
  const res = responseRecorder();
  await invokeError(new Error("Only JPEG, PNG and GIF image type is allowed"), {}, res);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.payload, { message: "Only valid JPEG, PNG, and GIF images are allowed" });
});

test("known client errors preserve their status and message", async () => {
  const res = responseRecorder();
  await invokeError({ statusCode: 422, message: "Invalid request fields" }, {}, res);
  assert.equal(res.statusCode, 422);
  assert.deepEqual(res.payload, { message: "Invalid request fields" });
});

test("unknown server errors hide internal messages from clients", async () => {
  const res = responseRecorder();
  await invokeError(new Error("database credentials leaked"), {}, res);
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.payload, { message: "Internal server error" });
});

test("error handler delegates when response headers have already been sent", async () => {
  const res = responseRecorder(true);
  let forwarded;
  await invokeError(new Error("late failure"), { files: [{ path: "keep" }] }, res, (error) => { forwarded = error; });
  assert.equal(forwarded.message, "late failure");
  assert.equal(calls.removed.some((files) => files[0]?.path === "keep"), false);
});

const invokeError = async (error, req, res, next = () => {}) => {
  const original = console.error;
  console.error = () => {};
  try { await errorHandler(error, req, res, next); } finally { console.error = original; }
};
