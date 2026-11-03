import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const calls = { connects: [], disconnects: 0, indexes: [], adapters: [], adapterCreates: [] };
const collection = { createIndex: async (...args) => { calls.indexes.push(args); if (calls.indexError) throw calls.indexError; } };
const mongoose = {
  connection: {
    readyState: 0,
    getClient: () => ({ db: () => ({ collection: (name) => { calls.collectionName = name; return collection; } }) }),
  },
  connect: async (...args) => { calls.connects.push(args); if (calls.connectError) throw calls.connectError; },
  disconnect: async () => { calls.disconnects++; return "disconnected"; },
};
const adapter = { createAdapter: (...args) => { calls.adapterCreates.push(args); return "mongo-adapter"; } };
const nodeMajorVersion = Number(process.versions.node.split(".")[0]);
const defaultMock = (value) => nodeMajorVersion >= 26 ? { exports: { default: value } } : { defaultExport: value };
const namedMock = (value) => nodeMajorVersion >= 26 ? { exports: value } : { namedExports: value };
mock.module("mongoose", defaultMock(mongoose));
mock.module("@socket.io/mongo-adapter", namedMock(adapter));
const { connectDatabase, disconnectDatabase, isDatabaseReady } = await import(pathToFileURL(resolve(process.cwd(), "config/database.js")));

beforeEach(() => {
  calls.connects.length = 0;
  calls.disconnects = 0;
  calls.indexes.length = 0;
  calls.adapters.length = 0;
  calls.adapterCreates.length = 0;
  calls.collectionName = undefined;
  calls.connectError = undefined;
  calls.indexError = undefined;
  mongoose.connection.readyState = 0;
});

test("database connection passes the configured URI to Mongoose", async () => {
  await connectDatabase("mongodb://localhost/clickmate-test", {}, false);
  assert.deepEqual(calls.connects, [["mongodb://localhost/clickmate-test"]]);
  assert.equal(calls.indexes.length, 0);
});

test("database connection creates the adapter TTL index and installs the Socket.IO adapter when enabled", async () => {
  const io = { adapter: (value) => calls.adapters.push(value) };
  await connectDatabase("mongodb://localhost/clickmate-test", io, true);
  assert.equal(calls.collectionName, "socket.io-adapter-events");
  assert.deepEqual(calls.indexes, [[{ createdAt: 1 }, { expireAfterSeconds: 3600 }]]);
  assert.deepEqual(calls.adapterCreates, [[collection, { addCreatedAtField: true }]]);
  assert.deepEqual(calls.adapters, ["mongo-adapter"]);
});

test("database readiness reflects Mongoose's connected state", () => {
  assert.equal(isDatabaseReady(), false);
  mongoose.connection.readyState = 1;
  assert.equal(isDatabaseReady(), true);
  mongoose.connection.readyState = 2;
  assert.equal(isDatabaseReady(), false);
});

test("disconnectDatabase returns Mongoose's disconnect result", async () => {
  assert.equal(await disconnectDatabase(), "disconnected");
  assert.equal(calls.disconnects, 1);
});

test("database connection propagates a MongoDB connection failure without installing an adapter", async () => {
  calls.connectError = new Error("database unavailable");
  const io = { adapter: (value) => calls.adapters.push(value) };

  await assert.rejects(connectDatabase("mongodb://localhost/failure", io, true), /database unavailable/);
  assert.equal(calls.indexes.length, 0);
  assert.equal(calls.adapterCreates.length, 0);
  assert.equal(calls.adapters.length, 0);
});

test("adapter index failure stops adapter installation and propagates the error", async () => {
  calls.indexError = new Error("index unavailable");
  const io = { adapter: (value) => calls.adapters.push(value) };

  await assert.rejects(connectDatabase("mongodb://localhost/failure", io, true), /index unavailable/);
  assert.equal(calls.indexes.length, 1);
  assert.equal(calls.adapterCreates.length, 0);
  assert.equal(calls.adapters.length, 0);
});
