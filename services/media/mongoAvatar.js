import { validateAvatar } from "./validateAvatar.js";
import sharp from "sharp";

const MAX_STORED_SIDE = 512;
const variants = { 128: { field: "smallBytes", quality: 68 }, 256: { field: "mediumBytes", quality: 76 } };

const resizeJpeg = (bytes, side, quality) => sharp(bytes)
  .resize(side, side, { fit: "inside", withoutEnlargement: true })
  .jpeg({ quality, mozjpeg: true }).toBuffer();

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
      const bytes = image.width > MAX_STORED_SIDE
        ? await resizeJpeg(image.bytes, MAX_STORED_SIDE, 82)
        : image.bytes;
      const width = Math.min(image.width, MAX_STORED_SIDE);
      const [smallBytes, mediumBytes] = await Promise.all([
        resizeJpeg(bytes, 128, 68), resizeJpeg(bytes, 256, 76),
      ]);
      const file = await files.create({ ownerId, bytes, smallBytes, mediumBytes, contentType: "image/jpeg", width, height: width });
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
    async read(mediaId, size = 512) {
      if (![128, 256, 512].includes(size)) return undefined;
      const file = await files.findById(mediaId);
      if (!file) return null;
      if (size === 512 || file.width <= size) return file;
      const variant = variants[size];
      return { ...(file.toObject?.() ?? file), bytes: file[variant.field] || await resizeJpeg(file.bytes, size, variant.quality), width: size, height: size };
    },
    async remove(ownerId) {
      const previous = await users.findOneAndUpdate({ _id: ownerId }, { $set: { avatarFileId: null } }, { new: false });
      if (!previous) return undefined;
      if (previous.avatarFileId) await files.deleteOne({ _id: previous.avatarFileId, ownerId }).catch(() => {});
      return null;
    },
  };
}
