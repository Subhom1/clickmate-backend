import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { createMongoAvatarService } from "../../services/media/mongoAvatar.js";

const ownerId = "507f1f77bcf86cd799439011";
const jpeg = await sharp({ create: { width: 512, height: 512, channels: 3, background: "#aa7744" } }).jpeg().toBuffer();

function fixture() {
  let pointer = null;
  const files = new Map();
  let counter = 0;
  const service = createMongoAvatarService({
    users: {
      findOneAndUpdate: async ({ _id }, { $set }) => {
        if (_id !== ownerId) return null;
        const previous = { avatarFileId: pointer };
        pointer = $set.avatarFileId;
        return previous;
      },
      findById: async id => id === ownerId ? { avatarFileId: pointer } : null,
    },
    files: {
      create: async file => {
        const saved = { _id: String(++counter), ...file };
        files.set(saved._id, saved);
        return saved;
      },
      findOne: async ({ _id, ownerId: owner }) => files.get(String(_id))?.ownerId === owner ? files.get(String(_id)) : null,
      findById: async id => files.get(String(id)) ?? null,
      deleteOne: async ({ _id }) => { files.delete(String(_id)); },
    },
  });
  return { service, files, current: () => pointer };
}

test("stores a validated square JPEG and returns it after a new read", async () => {
  const { service, files } = fixture();
  const avatar = await service.save(ownerId, { buffer: jpeg, mimetype: "image/jpeg" });
  assert.deepEqual(avatar, { mediaId: "1", width: 512, height: 512, contentType: "image/jpeg" });
  assert.deepEqual(await service.get(ownerId), avatar);
  assert.ok((await service.read("1")).bytes.length > 0);
  assert.equal(files.size, 1);
});

test("serves smaller JPEG variants and keeps the full avatar at 512 pixels", async () => {
  const { service, files } = fixture();
  await service.save(ownerId, { buffer: jpeg, mimetype: "image/jpeg" });
  const small = await service.read("1", 128);
  const medium = await service.read("1", 256);
  const full = await service.read("1", 512);
  assert.equal((await sharp(small.bytes).metadata()).width, 128);
  assert.equal((await sharp(medium.bytes).metadata()).width, 256);
  assert.equal((await sharp(full.bytes).metadata()).width, 512);
  assert.ok(small.bytes.length < full.bytes.length);
  assert.ok(medium.bytes.length < full.bytes.length);
  assert.equal(await service.read("1", 999), undefined);
  files.get("1").smallBytes = undefined;
  assert.equal((await sharp((await service.read("1", 128)).bytes).metadata()).width, 128);
});

test("caps an oversized square upload to a 512-pixel stored original", async () => {
  const { service } = fixture();
  const large = await sharp({ create: { width: 1024, height: 1024, channels: 3, background: "#aa7744" } }).jpeg().toBuffer();
  const result = await service.save(ownerId, { buffer: large, mimetype: "image/jpeg" });
  assert.equal(result.width, 512);
  assert.equal((await sharp((await service.read("1")).bytes).metadata()).width, 512);
});

test("replacement removes old bytes and deletion clears the user pointer", async () => {
  const { service, files, current } = fixture();
  await service.save(ownerId, { buffer: jpeg, mimetype: "image/jpeg" });
  const replacement = await service.save(ownerId, { buffer: jpeg, mimetype: "image/jpeg" });
  assert.equal(current(), "2");
  assert.equal(await service.read("1"), null);
  assert.equal(files.size, 1);
  assert.deepEqual(await service.get(ownerId), replacement);
  await service.remove(ownerId);
  assert.equal(current(), null);
  assert.equal(files.size, 0);
  assert.equal(await service.get(ownerId), null);
});

test("invalid uploads leave an existing avatar untouched", async () => {
  const { service, current, files } = fixture();
  await service.save(ownerId, { buffer: jpeg, mimetype: "image/jpeg" });
  await assert.rejects(service.save(ownerId, { buffer: jpeg, mimetype: "image/png" }), /INVALID_IMAGE/);
  const rectangle = await sharp({ create: { width: 512, height: 400, channels: 3, background: "#aa7744" } }).jpeg().toBuffer();
  await assert.rejects(service.save(ownerId, { buffer: rectangle, mimetype: "image/jpeg" }), /INVALID_DIMENSIONS/);
  assert.equal(current(), "1");
  assert.equal(files.size, 1);
});

test("a missing profile does not leave an orphaned avatar document", async () => {
  const { service, files } = fixture();
  await assert.rejects(service.save("507f1f77bcf86cd799439099", { buffer: jpeg, mimetype: "image/jpeg" }), /PROFILE_NOT_FOUND/);
  assert.equal(files.size, 0);
});
