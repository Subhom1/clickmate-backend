import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { validateAvatar } from "../../../../services/media/validateAvatar.js";

test("decodes and re-encodes a square avatar without embedded metadata", async () => {
  const input = await sharp({ create: { width: 512, height: 512, channels: 3, background: "red" } })
    .withMetadata({ exif: { IFD0: { Copyright: "private" } } }).png().toBuffer();
  const output = await validateAvatar(input, "image/png");
  assert.equal(output.contentType, "image/jpeg");
  assert.equal(output.width, 512);
  assert.equal(output.height, 512);
  const metadata = await sharp(output.bytes).metadata();
  assert.equal(metadata.format, "jpeg");
  assert.equal(metadata.exif, undefined);
});

test("rejects wrong declarations, malformed bytes, rectangles, oversize and animated images", async () => {
  const square = await sharp({ create: { width: 512, height: 512, channels: 3, background: "red" } }).png().toBuffer();
  const rectangle = await sharp({ create: { width: 512, height: 500, channels: 3, background: "red" } }).png().toBuffer();
  const huge = await sharp({ create: { width: 2049, height: 2049, channels: 3, background: "red" } }).png().toBuffer();
  const animated = await sharp({ create: { width: 10, height: 20, channels: 4, background: "red", pageHeight: 10 } }).gif({ loop: 0 }).toBuffer();
  for (const [bytes, type, code] of [
    [square, "image/jpeg", "INVALID_TYPE"], [Buffer.from("fake"), "image/png", "INVALID_IMAGE"],
    [rectangle, "image/png", "INVALID_DIMENSIONS"], [huge, "image/png", "INVALID_IMAGE"],
    [animated, "image/gif", "INVALID_TYPE"], [Buffer.alloc(2 * 1024 * 1024 + 1), "image/png", "INVALID_SIZE"],
  ]) await assert.rejects(validateAvatar(bytes, type), { code });
});
