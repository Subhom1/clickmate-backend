import mongoose from "mongoose";
import { canonicalizeUpload } from "./canonicalizeUpload.js";

function clientError(code, statusCode) {
  const error = new Error(code);
  error.statusCode = statusCode;
  return error;
}

export function createCompleteAvatarService({ assets, users, storage, now = () => new Date() }) {
  return async function complete(ownerId, mediaId) {
    if (!mongoose.isValidObjectId(mediaId)) throw clientError("INVALID_UPLOAD_SESSION", 400);
    let asset = await assets.findOne({ _id: mediaId, ownerId, purpose: "avatar" });
    if (!asset) throw clientError("UPLOAD_NOT_FOUND", 404);
    if (asset.status === "ready") {
      const user = await users.findById(ownerId);
      if (String(user?.avatarMediaId) !== String(asset._id)) throw clientError("UPLOAD_ALREADY_USED", 409);
      return { mediaId: String(asset._id), width: asset.width, height: asset.height, contentType: asset.contentType };
    }
    if (asset.status === "pending") {
      if (!asset.expiresAt || asset.expiresAt <= now()) throw clientError("UPLOAD_EXPIRED", 410);
      const canonical = await canonicalizeUpload(asset, storage);
      let committed;
      try {
        committed = await assets.findOneAndUpdate({ _id: mediaId, ownerId, status: "pending", expiresAt: { $gt: now() } },
          { $set: { canonicalKey: canonical.objectKey, contentType: canonical.contentType,
            sizeBytes: canonical.sizeBytes, width: canonical.width, height: canonical.height, status: "validated" } }, { new: true });
      } catch (error) {
        await storage.delete(canonical.objectKey).catch(() => {});
        throw error;
      }
      if (!committed) {
        await storage.delete(canonical.objectKey);
        asset = await assets.findOne({ _id: mediaId, ownerId });
      } else asset = committed;
    }
    if (asset.status !== "validated" || !asset.canonicalKey) throw clientError("UPLOAD_IN_PROGRESS", 409);
    if (asset.expiresAt && asset.expiresAt <= now()) {
      const current = await users.findById(ownerId);
      if (String(current?.avatarMediaId) !== String(asset._id)) throw clientError("UPLOAD_EXPIRED", 410);
    }
    const updated = await users.updateOne({ _id: ownerId }, { $set: { avatarMediaId: asset._id } });
    if (updated.matchedCount !== 1) throw clientError("PROFILE_NOT_FOUND", 404);
    await assets.updateOne({ _id: mediaId, ownerId, status: "validated" }, { $set: { status: "ready" } });
    return { mediaId: String(asset._id), width: asset.width, height: asset.height, contentType: asset.contentType };
  };
}
