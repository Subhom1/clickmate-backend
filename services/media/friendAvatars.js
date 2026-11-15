// Add short-lived photo URLs to friend records without exposing S3 object keys.
export async function withFriendAvatarUrls(friends, { assets, storage }) {
  return Promise.all(friends.map(async (friend) => {
    const profile = typeof friend.toObject === "function" ? friend.toObject() : { ...friend };
    if (!profile.avatarMediaId) return profile;

    const asset = await assets.findOne({
      _id: profile.avatarMediaId,
      ownerId: profile._id,
      purpose: "avatar",
      status: "ready",
    });
    if (!asset?.canonicalKey) return profile;

    const avatarUrl = await storage.readUrl(asset.canonicalKey, 300);
    return {
      ...profile,
      avatarUrl,
      avatarExpiresAt: new Date(Date.now() + 300000).toISOString(),
    };
  }));
}
