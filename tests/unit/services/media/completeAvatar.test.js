import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import mongoose from "mongoose";
import sharp from "sharp";
import { createCompleteAvatarService } from "../../../../services/media/completeAvatar.js";

test("confirms only the owner's uploaded bytes and repeated confirmation preserves the profile", async () => {
  const ownerId = new mongoose.Types.ObjectId();
  const mediaId = new mongoose.Types.ObjectId();
  const bytes = await sharp({ create: { width: 512, height: 512, channels: 3, background: "blue" } }).png().toBuffer();
  let asset = { _id: mediaId, ownerId, purpose: "avatar", objectKey: "avatars/signed", contentType: "image/png", sizeBytes: bytes.length, status: "pending", expiresAt: new Date(Date.now() + 60000) };
  const user = { avatarMediaId: null };
  let writes = 0;
  const service = createCompleteAvatarService({
    assets: {
      findOne: async query => String(query.ownerId) === String(ownerId) && String(query._id) === String(mediaId) ? asset : null,
      findOneAndUpdate: async (query, change) => {
        if (asset.status !== query.status) return null;
        asset = { ...asset, ...change.$set }; return asset;
      },
      updateOne: async (_query, change) => { asset = { ...asset, ...change.$set }; },
    },
    users: { findById: async () => user, updateOne: async (_query, change) => { user.avatarMediaId = change.$set.avatarMediaId; return { matchedCount: 1 }; } },
    storage: { head: async () => ({ ContentLength: bytes.length }), get: async () => ({ Body: Readable.from([bytes]) }), put: async () => { writes++; }, delete: async () => {} },
  });
  await assert.rejects(service(new mongoose.Types.ObjectId(), String(mediaId)), { statusCode: 404 });
  const first = await service(ownerId, String(mediaId));
  assert.equal(first.mediaId, String(mediaId));
  assert.equal(asset.status, "ready");
  assert.match(asset.canonicalKey, /^avatars\/validated\//);
  assert.equal(String(user.avatarMediaId), String(mediaId));
  assert.deepEqual(await service(ownerId, String(mediaId)), first);
  assert.equal(writes, 1);
  user.avatarMediaId = new mongoose.Types.ObjectId();
  await assert.rejects(service(ownerId, String(mediaId)), { statusCode: 409 });
});

test("rejects malformed and expired sessions before touching storage", async () => {
  const ownerId = new mongoose.Types.ObjectId();
  const mediaId = new mongoose.Types.ObjectId();
  let touched = false;
  const service = createCompleteAvatarService({
    assets: { findOne: async () => ({ _id: mediaId, ownerId, status: "pending", expiresAt: new Date(0) }) },
    storage: { head: async () => { touched = true; } },
  });
  await assert.rejects(service(ownerId, "bad"), { statusCode: 400 });
  await assert.rejects(service(ownerId, String(mediaId)), { statusCode: 410 });
  assert.equal(touched, false);
});

test("does not attach an expired validated upload that cleanup may remove", async () => {
  const ownerId = new mongoose.Types.ObjectId();
  const mediaId = new mongoose.Types.ObjectId();
  const service = createCompleteAvatarService({
    assets: { findOne: async () => ({ _id: mediaId, status: "validated", canonicalKey: "canonical", expiresAt: new Date(0) }) },
    users: { findById: async () => ({ avatarMediaId: null }), updateOne: async () => assert.fail("must not attach") },
  });
  await assert.rejects(service(ownerId, String(mediaId)), { statusCode: 410 });
});
