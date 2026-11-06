import mongoose from "mongoose";

const mediaAssetSchema = new mongoose.Schema({
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: "user", required: true, index: true },
  purpose: { type: String, required: true, enum: ["avatar"] },
  bucket: { type: String, required: true },
  objectKey: { type: String, required: true },
  storageProvider: { type: String, required: true },
  contentType: { type: String, required: true },
  sizeBytes: { type: Number, required: true, min: 1 },
  width: { type: Number, min: 1 },
  height: { type: Number, min: 1 },
  checksum: String,
  status: { type: String, required: true, enum: ["pending", "uploaded", "validated", "ready", "failed", "expired"], default: "pending" },
  expiresAt: Date,
}, { collection: "media_assets", timestamps: true });

mediaAssetSchema.index({ bucket: 1, objectKey: 1 }, { unique: true });
mediaAssetSchema.index({ status: 1, expiresAt: 1 });
export default mongoose.model("media_asset", mediaAssetSchema);
