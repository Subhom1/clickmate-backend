import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import sharp from "sharp";
import { canonicalizeUpload } from "../../../../services/media/canonicalizeUpload.js";

const asset = { objectKey: "avatars/signed", contentType: "image/png", sizeBytes: 0 };

test("reads actual bytes and stores a separate canonical avatar", async () => {
  const bytes = await sharp({ create: { width: 512, height: 512, channels: 3, background: "blue" } }).png().toBuffer();
  let written;
  const result = await canonicalizeUpload({ ...asset, sizeBytes: bytes.length }, {
    head: async () => ({ ContentLength: bytes.length }),
    get: async () => ({ Body: Readable.from([bytes]) }),
    put: async (...args) => { written = args; },
  });
  assert.match(result.objectKey, /^avatars\/validated\/[0-9a-f-]{36}$/);
  assert.notEqual(result.objectKey, asset.objectKey);
  assert.equal(result.contentType, "image/jpeg");
  assert.equal(result.width, 512);
  assert.equal(written[0], result.objectKey);
  assert.equal((await sharp(written[1]).metadata()).format, "jpeg");
});

test("rejects missing, changed and oversized objects before creating a canonical key", async () => {
  let wrote = false;
  const storage = { head: async () => ({ ContentLength: 5 }), get: async () => ({ Body: Readable.from([Buffer.alloc(6)]) }), put: async () => { wrote = true; } };
  await assert.rejects(canonicalizeUpload({ ...asset, sizeBytes: 6 }, storage), { code: "INVALID_SIZE" });
  await assert.rejects(canonicalizeUpload({ ...asset, sizeBytes: 5 }, storage), { code: "INVALID_SIZE" });
  assert.equal(wrote, false);
});
