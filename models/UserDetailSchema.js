import mongoose from "mongoose";

const UserDetailSchema = new mongoose.Schema(
  {
    username: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    interest: [{ type: mongoose.Schema.Types.ObjectId, ref: "interest" }],
    created_at: { type: Date, default: Date() },
    updated_at: { type: Date, default: Date() },
  },
  {
    collection: "user",
  }
);

const UserDetail = mongoose.model("user", UserDetailSchema);

export default UserDetail;
