import mongoose from "mongoose";
import { canonicalizeUpload } from "./canonicalizeUpload.js";

function clientError(code, statusCode) {
  const error = new Error(code);
  error.statusCode = statusCode;
  return error;
}

function isLaterUpload(candidate, current) {
  const candidateTime = candidate.createdAt?.getTime() ?? 0;
  const currentTime = current.createdAt?.getTime() ?? 0;
  if (candidateTime !== currentTime) return candidateTime > currentTime;
  return String(candidate._id) > String(current._id);
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
    // Compare the observed profile value so simultaneous confirmations cannot
    // silently replace one another. The later upload may still replace an older one.
    let attached = false;
    for (let attempt = 0; attempt < 5; attempt++) {
      const user = await users.findById(ownerId);
      if (!user) throw clientError("PROFILE_NOT_FOUND", 404);
      const currentId = user.avatarMediaId;
      if (currentId && String(currentId) !== String(asset._id)) {
        const current = await assets.findOne({ _id: currentId, ownerId, purpose: "avatar" });
        if (current && !isLaterUpload(asset, current)) throw clientError("UPLOAD_ALREADY_USED", 409);
      }
      if (String(currentId) === String(asset._id)) { attached = true; break; }
      const updated = await users.updateOne({ _id: ownerId, avatarMediaId: currentId ?? null },
        { $set: { avatarMediaId: asset._id } });
      if (updated.matchedCount === 1) { attached = true; break; }
    }
    if (!attached) throw clientError("UPLOAD_IN_PROGRESS", 409);
    await assets.updateOne({ _id: mediaId, ownerId, status: "validated" }, { $set: { status: "ready" } });
    return { mediaId: String(asset._id), width: asset.width, height: asset.height, contentType: asset.contentType };
  };
}
