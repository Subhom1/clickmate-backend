import mongoose from "mongoose";

const avatarFileSchema = new mongoose.Schema({
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: "user", required: true, index: true },
  bytes: { type: Buffer, required: true },
  smallBytes: { type: Buffer },
  mediumBytes: { type: Buffer },
  contentType: { type: String, required: true, enum: ["image/jpeg"] },
  width: { type: Number, required: true },
  height: { type: Number, required: true },
}, { collection: "avatar_files", timestamps: true });

export default mongoose.model("avatar_file", avatarFileSchema);
