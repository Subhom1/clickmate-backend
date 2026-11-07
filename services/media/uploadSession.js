import { randomUUID } from "node:crypto";

export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
export const SESSION_SECONDS = 600;
const types = new Set(["image/jpeg", "image/png", "image/webp"]);

export function createUploadSessionService({ assets, storage, consumeQuota }) {
  return async function createSession(ownerId, input) {
    if (!input || !types.has(input.contentType) || !Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 1 || input.sizeBytes > MAX_AVATAR_BYTES || Object.keys(input).some(key => !["contentType", "sizeBytes"].includes(key))) {
      const error = new Error("Invalid avatar upload request"); error.statusCode = 400; throw error;
    }
    await consumeQuota(ownerId);
    const objectKey = `avatars/${randomUUID()}`;
    const signed = await storage.createUpload(objectKey, input.contentType, input.sizeBytes, SESSION_SECONDS);
    const expiresAt = signed.expiresAt;
    if (!(expiresAt instanceof Date) || !Number.isFinite(expiresAt.getTime())) throw new Error("Invalid upload expiry");
    const asset = await assets.create({ ownerId, purpose: "avatar", bucket: storage.bucket, objectKey, storageProvider: "s3", contentType: input.contentType, sizeBytes: input.sizeBytes, status: "pending", expiresAt });
    return { mediaId: String(asset._id), uploadUrl: signed.url, method: "POST", fields: signed.fields, expiresAt };
  };
}
