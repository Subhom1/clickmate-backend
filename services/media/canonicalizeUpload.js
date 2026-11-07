import { randomUUID } from "node:crypto";
import { MAX_AVATAR_BYTES } from "./uploadSession.js";
import { InvalidAvatarError, validateAvatar } from "./validateAvatar.js";

async function readBounded(body, expectedSize) {
  if (!body || !body[Symbol.asyncIterator]) throw new Error("Storage response has no readable body");
  const chunks = [];
  let size = 0;
  for await (const chunk of body) {
    size += chunk.length;
    if (size > MAX_AVATAR_BYTES) {
      body.destroy?.();
      throw new InvalidAvatarError("INVALID_SIZE");
    }
    chunks.push(Buffer.from(chunk));
  }
  if (size !== expectedSize) throw new InvalidAvatarError("INVALID_SIZE");
  return Buffer.concat(chunks, size);
}

// Creates an object outside the signed upload key. The caller must persist the
// returned key before referencing it from a profile, then clean up on failure.
export async function canonicalizeUpload(asset, storage) {
  const head = await storage.head(asset.objectKey);
  if (head.ContentLength !== asset.sizeBytes || head.ContentLength > MAX_AVATAR_BYTES) {
    throw new InvalidAvatarError("INVALID_SIZE");
  }
  const response = await storage.get(asset.objectKey);
  const bytes = await readBounded(response.Body, asset.sizeBytes);
  const validated = await validateAvatar(bytes, asset.contentType);
  const objectKey = `avatars/validated/${randomUUID()}`;
  await storage.put(objectKey, validated.bytes, validated.contentType);
  return { objectKey, contentType: validated.contentType, sizeBytes: validated.bytes.length,
    width: validated.width, height: validated.height };
}
