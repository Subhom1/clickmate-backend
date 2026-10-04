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
      default: false,
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

userSearchSchema.index({ userId: 1 }, { unique: true });
userSearchSchema.index({ isLocked: 1, created_at: 1 });
userSearchSchema.index({ created_at: 1 }, { expireAfterSeconds: 300 });

const UserSearch = mongoose.model("search", userSearchSchema);

export default UserSearch;
