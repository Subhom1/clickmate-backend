import mongoose from "mongoose";

const userSearchSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: "user",
    },
    query: {
      type: String,
      required: true,
    },
    isLocked: {
      type: Boolean,
    },
    created_at: {
      type: Date,
      default: Date.now,
    },
  },
  {
    collection: "search",
  }
);

const UserSearch = mongoose.model("search", userSearchSchema);

export default UserSearch;
