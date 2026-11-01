import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

let child;
let spawnArguments;
let responseForRequest;
const spawn = (...args) => {
  spawnArguments = args;
  child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = {
    writes: [],
    write(line) {
      this.writes.push(line);
      const request = JSON.parse(line);
      const response = responseForRequest(request);
      if (response) queueMicrotask(() => child.stdout.write(`${JSON.stringify(response)}\n`));
      return true;
    },
  };
  child.kill = (signal) => { child.killedWith = signal; return true; };
  return child;
};
const nodeMajorVersion = Number(process.versions.node.split(".")[0]);
const spawnMock = nodeMajorVersion >= 26 ? { exports: { spawn } } : { namedExports: { spawn } };
mock.module("child_process", spawnMock);
const { createSimilarityService } = await import(pathToFileURL(resolve(process.cwd(), "services/similarityService.js")));
const startReadyWorker = async (service) => {
  const starting = service.start();
  child.stdout.write('{"ready":true}\n');
  await starting;
};

beforeEach(() => {
  child = null;
  spawnArguments = null;
  responseForRequest = (request) => ({ id: request.id, similarity_score: 0.75 });
});

test("similarity comparison is rejected until the worker announces readiness", async () => {
  const service = createSimilarityService("python-test");
  await assert.rejects(service.compare("left", "right"), /not ready/);
});

test("start launches the JSON-lines worker and waits for its ready frame", async () => {
  const service = createSimilarityService("python-test");
  await startReadyWorker(service);
  assert.equal(spawnArguments[0], "python-test");
  assert.deepEqual(spawnArguments[1], ["scripts/similarity_worker.py"]);
  assert.deepEqual(spawnArguments[2].stdio, ["pipe", "pipe", "pipe"]);
});

test("compare writes a request frame and resolves the response with the same ID", async () => {
  const service = createSimilarityService("python-test");
  await startReadyWorker(service);
  const result = await service.compare("left", "right");
  const [request] = child.stdin.writes.map((line) => JSON.parse(line));
  assert.deepEqual(request, { id: result.id, text1: "left", text2: "right" });
  assert.equal(result.similarity_score, 0.75);
});

test("compare rejects worker error frames with the worker's message", async () => {
  responseForRequest = (request) => ({ id: request.id, error: "model input is invalid" });
  const service = createSimilarityService("python-test");
  await startReadyWorker(service);
  await assert.rejects(service.compare("left", "right"), /model input is invalid/);
});

test("worker exit rejects all pending comparisons and clears the pending queue", async () => {
  responseForRequest = () => null;
  const service = createSimilarityService("python-test");
  await startReadyWorker(service);
  const pending = service.compare("left", "right");
  child.emit("exit", 1);
  await assert.rejects(pending, /Similarity worker stopped/);
});

test("stop sends SIGTERM to the worker process", async () => {
  const service = createSimilarityService("python-test");
  await startReadyWorker(service);
  service.stop();
  assert.equal(child.killedWith, "SIGTERM");
});
