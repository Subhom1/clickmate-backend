const GRACE_MS = 60 * 60 * 1000;

export function createAvatarCleanup({ assets, users, storage, now = () => new Date() }) {
  return async function cleanup() {
    const cutoff = new Date(now().getTime() - GRACE_MS);
    const candidates = await assets.find({ purpose: "avatar", status: { $in: ["pending", "validated", "ready"] },
      expiresAt: { $lt: cutoff } }).sort({ expiresAt: 1 }).limit(100);
    let removed = 0;
    for (const asset of candidates) {
      if (asset.bucket !== storage.bucket) continue;
      if (await users.exists({ avatarMediaId: asset._id })) continue;
      await storage.delete(asset.objectKey);
      if (asset.canonicalKey) await storage.delete(asset.canonicalKey);
      const result = await assets.updateOne({ _id: asset._id, status: asset.status }, { $set: { status: "expired" } });
      removed += result.modifiedCount;
    }
    return removed;
  };
}
