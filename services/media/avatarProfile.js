export function createAvatarProfileService({ users, assets, storage }) {
  async function get(ownerId) {
    const user = await users.findById(ownerId);
    if (!user) return null;
    if (!user.avatarMediaId) return { avatar: null };
    const asset = await assets.findOne({ _id: user.avatarMediaId, ownerId, status: "ready", purpose: "avatar" });
    if (!asset?.canonicalKey) return { avatar: null };
    const url = await storage.readUrl(asset.canonicalKey, 300);
    // Return a fresh five-minute link instead of storing an expiring URL on the profile.
    return { avatar: { mediaId: String(asset._id), url, width: asset.width, height: asset.height,
      contentType: asset.contentType, expiresAt: new Date(Date.now() + 300000).toISOString() } };
  }

  async function remove(ownerId) {
    const user = await users.findById(ownerId);
    if (!user) return null;
    if (!user.avatarMediaId) return { avatar: null };
    // Clear only the avatar we read, leaving any newer upload attached.
    await users.updateOne({ _id: ownerId, avatarMediaId: user.avatarMediaId }, { $set: { avatarMediaId: null } });
    return get(ownerId);
  }

  return { get, remove };
}
