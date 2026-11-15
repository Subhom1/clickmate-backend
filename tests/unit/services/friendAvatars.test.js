import test from "node:test";
import assert from "node:assert/strict";
import { withFriendAvatarUrls } from "../../../services/media/friendAvatars.js";

test("adds a fresh signed URL only for the friend's ready avatar", async () => {
  const calls = [];
  const friends = [
    { _id: "alice", avatarMediaId: "photo-1", fullname: "Alice" },
    { _id: "bob", avatarFileId: "legacy-photo", fullname: "Bob" },
  ];
  const profiles = await withFriendAvatarUrls(friends, {
    assets: { findOne: async (query) => {
      calls.push(query);
      return { canonicalKey: "private/alice.jpg" };
    } },
    storage: { readUrl: async (key, seconds) => {
      assert.equal(key, "private/alice.jpg");
      assert.equal(seconds, 300);
      return "https://photos.example/alice?signature=new";
    } },
  });

  assert.deepEqual(calls, [{ _id: "photo-1", ownerId: "alice", purpose: "avatar", status: "ready" }]);
  assert.equal(profiles[0].avatarUrl, "https://photos.example/alice?signature=new");
  assert.ok(Date.parse(profiles[0].avatarExpiresAt) > Date.now());
  assert.deepEqual(profiles[1], friends[1]);
  assert.equal(friends[0].avatarUrl, undefined);
});

test("does not return a URL for a missing or unfinished avatar", async () => {
  const [profile] = await withFriendAvatarUrls([{ _id: "alice", avatarMediaId: "photo-1" }], {
    assets: { findOne: async () => null },
    storage: { readUrl: async () => { throw new Error("Should not sign a missing avatar"); } },
  });
  assert.equal(profile.avatarUrl, undefined);
});
