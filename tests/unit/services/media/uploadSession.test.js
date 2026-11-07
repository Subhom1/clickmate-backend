import { test } from "node:test";
import assert from "node:assert/strict";
import { createUploadSessionService, MAX_AVATAR_BYTES } from "../../../../services/media/uploadSession.js";

test("creates a scoped pending session with a random key and expiry", async () => {
  let record, request;
  const create = createUploadSessionService({ consumeQuota: async () => {}, assets: { create: async data => (record = data, { _id: "id" }) }, storage: { bucket: "private", createUpload: async (...args) => (request = args, { url: "https://example.test", fields: {}, expiresAt: new Date("2026-01-01T00:10:00Z") }) } });
  const result = await create("owner", { contentType: "image/jpeg", sizeBytes: 123 });
  assert.equal(record.ownerId, "owner"); assert.equal(record.status, "pending");
  assert.match(record.objectKey, /^avatars\/[0-9a-f-]{36}$/); assert.deepEqual(request.slice(1), ["image/jpeg", 123, 600]);
  assert.equal(result.expiresAt.toISOString(), "2026-01-01T00:10:00.000Z"); assert.equal(result.method, "POST");
});

test("rejects malformed and oversized requests before calling storage", async () => {
  const create = createUploadSessionService({ assets: {}, storage: {} });
  for (const input of [null, { contentType: "image/gif", sizeBytes: 1 }, { contentType: "image/jpeg", sizeBytes: MAX_AVATAR_BYTES + 1 }, { contentType: "image/jpeg", sizeBytes: 1, key: "evil" }]) await assert.rejects(create("owner", input), { statusCode: 400 });
});

test("propagates signing and persistence failures", async () => {
  const input = { contentType: "image/png", sizeBytes: 10 };
  await assert.rejects(createUploadSessionService({ consumeQuota: async () => {}, storage: { createUpload: async () => { throw Error("sign"); } } })("owner", input), /sign/);
  await assert.rejects(createUploadSessionService({ consumeQuota: async () => {}, storage: { createUpload: async () => ({ expiresAt: new Date() }) }, assets: { create: async () => { throw Error("db"); } } })("owner", input), /db/);
  await assert.rejects(createUploadSessionService({ consumeQuota: async () => {}, storage: { createUpload: async () => ({}) }, assets: { create: async () => { throw Error("must not persist"); } } })("owner", input), /expiry/);
});

test("S3 policy fixes the object key, content type, size and expiry", async () => {
  const { S3Client } = await import("@aws-sdk/client-s3");
  const { S3Storage } = await import("../../../../services/media/S3Storage.js");
  const client = new S3Client({ region: "us-east-1", credentials: { accessKeyId: "test", secretAccessKey: "test" } });
  const signed = await new S3Storage(client, "private").createUpload("avatars/random", "image/jpeg", 100, 600);
  const policy = JSON.parse(Buffer.from(signed.fields.Policy, "base64").toString());
  assert.equal(signed.expiresAt.toISOString(), new Date(policy.expiration).toISOString());
  assert.ok(policy.conditions.some(c => c.key === "avatars/random"));
  assert.ok(policy.conditions.some(c => c["Content-Type"] === "image/jpeg"));
  assert.ok(policy.conditions.some(c => Array.isArray(c) && c.join(",") === "content-length-range,100,100"));
  assert.ok(new Date(policy.expiration).getTime() - Date.now() <= 600000);
});

test("quota denial prevents signing and persistence", async () => {
  let signed = false;
  const create = createUploadSessionService({
    consumeQuota: async () => { const error = Error("quota"); error.statusCode = 429; throw error; },
    storage: { createUpload: async () => { signed = true; } },
    assets: { create: async () => { throw Error("must not persist"); } },
  });
  await assert.rejects(create("owner", { contentType: "image/jpeg", sizeBytes: 100 }), { statusCode: 429 });
  assert.equal(signed, false);
});
