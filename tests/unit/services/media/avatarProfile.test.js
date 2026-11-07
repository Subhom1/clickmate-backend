import { test } from "node:test";
import assert from "node:assert/strict";
import { createAvatarProfileService } from "../../../../services/media/avatarProfile.js";

test("returns a temporary URL only for the owner's ready canonical avatar", async () => {
  const user = { avatarMediaId: "media" };
  let lookup, signed;
  const profile = createAvatarProfileService({
    users: { findById: async () => user, updateOne: async () => ({ matchedCount: 1 }) },
    assets: { findOne: async query => { lookup = query; return { _id: "media", canonicalKey: "avatars/validated/id", width: 512, height: 512, contentType: "image/jpeg" }; } },
    storage: { readUrl: async (key, expiry) => { signed = [key, expiry]; return "https://private.test/signed"; } },
  });
  const result = await profile.get("owner");
  assert.deepEqual(lookup, { _id: "media", ownerId: "owner", status: "ready", purpose: "avatar" });
  assert.deepEqual(signed, ["avatars/validated/id", 300]);
  assert.equal(result.avatar.url, "https://private.test/signed");
});

test("removal clears only the observed avatar and is idempotent", async () => {
  const user = { avatarMediaId: "media" };
  let query;
  const profile = createAvatarProfileService({
    users: { findById: async () => user, updateOne: async (filter, change) => { query = filter; user.avatarMediaId = change.$set.avatarMediaId; return { matchedCount: 1 }; } },
    assets: { findOne: async () => null }, storage: {},
  });
  assert.deepEqual(await profile.remove("owner"), { avatar: null });
  assert.deepEqual(query, { _id: "owner", avatarMediaId: "media" });
  assert.deepEqual(await profile.remove("owner"), { avatar: null });
});
