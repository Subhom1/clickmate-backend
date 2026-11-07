import { test } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import MediaAsset from "../../models/MediaAsset.js";
import UserDetail from "../../models/UserDetailSchema.js";
import { createS3Storage, S3Storage } from "../../services/media/S3Storage.js";

test("media requires an owner and valid lifecycle fields", () => {
  const asset = new MediaAsset({ purpose: "avatar", bucket: "private", objectKey: "random", storageProvider: "s3", contentType: "image/png", sizeBytes: 2 });
  assert.ok(asset.validateSync().errors.ownerId);
  asset.ownerId = new mongoose.Types.ObjectId();
  assert.equal(asset.validateSync(), undefined);
  asset.status = "unknown";
  assert.ok(asset.validateSync().errors.status);
  assert.ok(MediaAsset.schema.indexes().some(([fields, opts]) => fields.bucket === 1 && fields.objectKey === 1 && opts.unique));
  assert.equal(UserDetail.schema.path("avatarMediaId").options.ref, "media_asset");
});

test("storage validates configuration and scopes commands to its bucket", async () => {
  assert.throws(() => createS3Storage({}), /required/);
  assert.throws(() => createS3Storage({ MEDIA_S3_BUCKET: "b", MEDIA_S3_REGION: "r", MEDIA_S3_ENDPOINT: "http://example.com" }), /HTTPS/);
  const commands = [];
  const storage = new S3Storage({ send: async command => { commands.push(command); } }, "private");
  await storage.head("key"); await storage.get("key"); await storage.delete("key");
  assert.deepEqual(commands.map(command => command.input), Array(3).fill({ Bucket: "private", Key: "key" }));
});

test("isolated storage double supports object lifecycle", async () => {
  const { MemoryStorage } = await import("../helpers/MemoryStorage.js");
  const storage = new MemoryStorage();
  await storage.put("key", Buffer.from("hello"));
  assert.equal((await storage.head("key")).ContentLength, 5);
  assert.equal((await storage.get("key")).Body.toString(), "hello");
  await storage.delete("key");
  await assert.rejects(storage.head("key"));
});
