import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const withFakeModel = async (input) => {
  const root = await mkdtemp(join(tmpdir(), "clickmate-similarity-worker-"));
  const packageDirectory = join(root, "sentence_transformers");
  await mkdir(packageDirectory);
  await writeFile(join(packageDirectory, "__init__.py"), `
from types import SimpleNamespace

class SentenceTransformer:
    def __init__(self, name):
        self.name = name

    def encode(self, texts, convert_to_tensor=False):
        return [len(text) for text in texts]

class _Util:
    @staticmethod
    def pytorch_cos_sim(left, right):
        return SimpleNamespace(item=lambda: 0.625)

util = _Util()
`);
  try {
    return spawnSync("python3", [resolve("scripts/similarity_worker.py")], {
      cwd: process.cwd(),
      env: { ...process.env, PYTHONPATH: [root, process.env.PYTHONPATH].filter(Boolean).join(":"), PYTHONDONTWRITEBYTECODE: "1" },
      input,
      encoding: "utf8",
      timeout: 5000,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

test("Python similarity worker sends a ready frame and correlates multiple requests by ID", async () => {
  const result = await withFakeModel([
    JSON.stringify({ id: "request-a", text1: "forest", text2: "woods" }),
    JSON.stringify({ id: "request-b", text1: "tea", text2: "coffee" }),
  ].join("\n") + "\n");
  assert.equal(result.status, 0, result.stderr);
  const frames = result.stdout.trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(frames, [
    { ready: true },
    { id: "request-a", similarity_score: 0.625 },
    { id: "request-b", similarity_score: 0.625 },
  ]);
});

test("Python similarity worker reports a malformed request and continues processing the stream", async () => {
  const result = await withFakeModel([
    JSON.stringify({ id: "bad-request", text1: "only one input" }),
    JSON.stringify({ id: "good-request", text1: "left", text2: "right" }),
  ].join("\n") + "\n");
  assert.equal(result.status, 0, result.stderr);
  const frames = result.stdout.trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(frames[0], { ready: true });
  assert.equal(frames[1].id, "bad-request");
  assert.match(frames[1].error, /text2/);
  assert.deepEqual(frames[2], { id: "good-request", similarity_score: 0.625 });
});
