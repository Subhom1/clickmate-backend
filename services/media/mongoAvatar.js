import { validateAvatar } from "./validateAvatar.js";

export function createMongoAvatarService({ users, files }) {
  const metadata = file => file ? {
    mediaId: String(file._id), width: file.width, height: file.height,
    contentType: file.contentType,
  } : null;
  return {
    async save(ownerId, uploaded) {
      if (!uploaded?.buffer || uploaded.mimetype !== "image/jpeg") {
        const error = new Error("INVALID_IMAGE"); error.statusCode = 400; throw error;
      }
      const image = await validateAvatar(uploaded.buffer, uploaded.mimetype);
      const file = await files.create({ ownerId, ...image });
      let previous;
      try {
        previous = await users.findOneAndUpdate({ _id: ownerId }, { $set: { avatarFileId: file._id } }, { new: false });
        if (!previous) {
          const error = new Error("PROFILE_NOT_FOUND"); error.statusCode = 404; throw error;
        }
      } catch (error) {
        await files.deleteOne({ _id: file._id, ownerId }).catch(() => {});
        throw error;
      }
      if (previous.avatarFileId) await files.deleteOne({ _id: previous.avatarFileId, ownerId }).catch(() => {});
      return metadata(file);
    },
    async get(ownerId) {
      const user = await users.findById(ownerId);
      if (!user) return undefined;
      if (!user.avatarFileId) return null;
      return metadata(await files.findOne({ _id: user.avatarFileId, ownerId }));
    },
    async read(mediaId) {
      return files.findById(mediaId);
    },
    async remove(ownerId) {
      const previous = await users.findOneAndUpdate({ _id: ownerId }, { $set: { avatarFileId: null } }, { new: false });
      if (!previous) return undefined;
      if (previous.avatarFileId) await files.deleteOne({ _id: previous.avatarFileId, ownerId }).catch(() => {});
      return null;
    },
  };
}
