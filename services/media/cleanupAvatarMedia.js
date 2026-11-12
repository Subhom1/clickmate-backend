const GRACE_MS = 60 * 60 * 1000;

export function createAvatarCleanup({ assets, users, storage, now = () => new Date() }) {
  return async function cleanup() {
    const cutoff = new Date(now().getTime() - GRACE_MS);
    // Validated assets can still be attached by an in-flight confirmation.
    // Retain them until attachment and cleanup can coordinate durably.
    const query = { purpose: "avatar", bucket: storage.bucket, status: { $in: ["pending", "ready"] }, expiresAt: { $lt: cutoff } };
    let lastId;
    let removed = 0;
    while (true) {
    if (lastId) query._id = { $gt: lastId };
    const candidates = await assets.find(query).sort({ _id: 1 }).limit(100);
    if (!candidates.length) break;
    for (const asset of candidates) {
      if (await users.exists({ avatarMediaId: asset._id })) continue;
      await storage.delete(asset.objectKey);
      if (asset.canonicalKey) await storage.delete(asset.canonicalKey);
      const result = await assets.updateOne({ _id: asset._id, status: asset.status }, { $set: { status: "expired" } });
      removed += result.modifiedCount;
    }
    lastId = candidates[candidates.length - 1]._id;
    if (candidates.length < 100) break;
    }
    return removed;
  };
}
