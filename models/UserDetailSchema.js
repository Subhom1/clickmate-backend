import mongoose from "mongoose";

const UserDetailSchema = new mongoose.Schema(
  {
    fullname: { type: String, required: true },
    email: { type: String, required: true, unique: true },
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
    created_at: { type: Date, default: Date() },
    updated_at: { type: Date, default: Date() },
  },
  {
    collection: "user",
  }
);

const UserDetail = mongoose.model("user", UserDetailSchema);

export default UserDetail;
