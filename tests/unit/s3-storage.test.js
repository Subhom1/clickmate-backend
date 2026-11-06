import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { S3Client } from "@aws-sdk/client-s3";
import { S3Storage } from "../../services/media/S3Storage.js";

test("S3 SDK adapter signs scoped requests and propagates service failures", async t => {
  const requests = [];
  const requestHandler = { handle: async request => {
    requests.push(request);
    return { response: { statusCode: request.method === "HEAD" ? 404 : 200, headers: {}, body: Readable.from([request.method === "GET" ? "contents" : ""]) } };
  }, destroy() {} };
  const client = new S3Client({ region: "us-east-1", endpoint: "https://storage.example.test", forcePathStyle: true, credentials: { accessKeyId: "test", secretAccessKey: "test" }, requestHandler, maxAttempts: 1 });
  t.after(() => client.destroy());
  const storage = new S3Storage(client, "private-bucket");
  await storage.put("folder/key", Buffer.from("bytes"), "image/png");
  assert.equal(await (await storage.get("folder/key")).Body.transformToString(), "contents");
  await assert.rejects(storage.head("missing"), error => error.$metadata.httpStatusCode === 404);
  await storage.delete("folder/key");
  assert.deepEqual(requests.map(({ method, path }) => [method, path]), [["PUT", "/private-bucket/folder/key"], ["GET", "/private-bucket/folder/key"], ["HEAD", "/private-bucket/missing"], ["DELETE", "/private-bucket/folder/key"]]);
  assert.ok(requests.every(request => request.headers.authorization.startsWith("AWS4-HMAC-SHA256 ")));
});

test("credential provider failures propagate without a storage request", async () => {
  const client = new S3Client({ region: "us-east-1", credentials: async () => { throw new Error("credentials unavailable"); }, maxAttempts: 1 });
  try { await assert.rejects(new S3Storage(client, "private").head("key"), /credentials unavailable/); }
  finally { client.destroy(); }
});
