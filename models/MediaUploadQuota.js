import mongoose from "mongoose";

// _id is the owner ID and UTC hour; MongoDB's mandatory _id index makes
// concurrent increments atomic even if automatic index creation is disabled.
const mediaUploadQuotaSchema = new mongoose.Schema({
  _id: String,
  count: { type: Number, required: true },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
}, { collection: "media_upload_quotas", versionKey: false });

export default mongoose.model("media_upload_quota", mediaUploadQuotaSchema);
