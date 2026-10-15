import mongoose from "mongoose";

const UserDetailSchema = new mongoose.Schema(
  {
    fullname: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    firebaseUid: { type: String, unique: true, sparse: true, immutable: true },
    bio: { type: String, default: "No Bio", maxlength: 2000 },
    birthdate: {
      type: Date,
      required: false,
    },
    interests: [{ type: mongoose.Schema.Types.ObjectId, ref: "interest" }],
    friends: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "user", // Reference to other User documents
      },
    ],
    search_count: {
      type: Number,
      default: 0,
    },
    search_reset_date: {
      type: Date,
    },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now },
  },
  {
    collection: "user",
  }
);

const UserDetail = mongoose.model("user", UserDetailSchema);

export default UserDetail;
