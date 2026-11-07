import { test } from "node:test";
import assert from "node:assert/strict";
import { createAvatarCleanup } from "../../../../services/media/cleanupAvatarMedia.js";

test("removes old unreferenced objects but preserves active and foreign-bucket media", async () => {
  const media = [
    { _id: "pending", bucket: "private", status: "pending", objectKey: "signed-1" },
    { _id: "old", bucket: "private", status: "ready", objectKey: "signed-2", canonicalKey: "canonical-2" },
    { _id: "active", bucket: "private", status: "ready", objectKey: "signed-3", canonicalKey: "canonical-3" },
    { _id: "foreign", bucket: "other", status: "pending", objectKey: "signed-4" },
  ];
  const deleted = [], expired = [];
  const cleanup = createAvatarCleanup({
    assets: {
      find: query => ({ sort: () => ({ limit: async () => {
        assert.equal(query.expiresAt.$lt.toISOString(), "2026-01-01T00:00:00.000Z");
        return media;
      } }) }),
      updateOne: async query => { expired.push(query._id); return { modifiedCount: 1 }; },
    },
    users: { exists: async query => query.avatarMediaId === "active" },
    storage: { bucket: "private", delete: async key => { deleted.push(key); } },
    now: () => new Date("2026-01-01T01:00:00Z"),
  });
  assert.equal(await cleanup(), 2);
  assert.deepEqual(deleted, ["signed-1", "signed-2", "canonical-2"]);
  assert.deepEqual(expired, ["pending", "old"]);
});

test("storage failure leaves asset eligible for a later retry", async () => {
  let updated = false;
  const cleanup = createAvatarCleanup({
    assets: { find: () => ({ sort: () => ({ limit: async () => [{ _id: "old", bucket: "private", status: "ready", objectKey: "key" }] }) }), updateOne: async () => { updated = true; } },
    users: { exists: async () => false },
    storage: { bucket: "private", delete: async () => { throw Error("storage unavailable"); } },
  });
  await assert.rejects(cleanup(), /storage unavailable/);
  assert.equal(updated, false);
});
