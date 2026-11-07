import sharp from "sharp";
import { MAX_AVATAR_BYTES } from "./uploadSession.js";

const MAX_DIMENSION = 2048;
const MAX_PIXELS = MAX_DIMENSION * MAX_DIMENSION;
const formats = new Map([["jpeg", "image/jpeg"], ["png", "image/png"], ["webp", "image/webp"]]);

export class InvalidAvatarError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
    this.statusCode = 400;
  }
}

// Only these newly encoded bytes may be promoted to an active avatar.
export async function validateAvatar(bytes, declaredContentType) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > MAX_AVATAR_BYTES) {
    throw new InvalidAvatarError("INVALID_SIZE");
  }

  try {
    const image = sharp(bytes, { limitInputPixels: MAX_PIXELS, failOn: "error", animated: true });
    const metadata = await image.metadata();
    if (formats.get(metadata.format) !== declaredContentType) throw new InvalidAvatarError("INVALID_TYPE");
    if (metadata.pages && metadata.pages !== 1) throw new InvalidAvatarError("INVALID_PAGES");
    if (!metadata.width || !metadata.height || metadata.width !== metadata.height ||
        metadata.width > MAX_DIMENSION || metadata.width * metadata.height > MAX_PIXELS) {
      throw new InvalidAvatarError("INVALID_DIMENSIONS");
    }

    // Re-encoding strips client metadata and removes any trailing non-image bytes.
    const { data, info } = await image.rotate().flatten({ background: "#ffffff" })
      .jpeg({ quality: 82, mozjpeg: true }).toBuffer({ resolveWithObject: true });
    if (info.width !== info.height || data.length > MAX_AVATAR_BYTES) {
      throw new InvalidAvatarError("INVALID_OUTPUT");
    }
    return { bytes: data, contentType: "image/jpeg", width: info.width, height: info.height };
  } catch (error) {
    if (error instanceof InvalidAvatarError) throw error;
    throw new InvalidAvatarError("INVALID_IMAGE");
  }
}
