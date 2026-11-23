import mongoose from "mongoose";
import { isValidSearchDate, isValidSearchTime } from "../utils/validation.js";

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
    date: {
      type: String,
      default: null,
      validate: {
        validator: (value) => value == null || isValidSearchDate(value),
        message: "Search date must use YYYY-MM-DD",
      },
    },
    time: {
      type: String,
      default: null,
      validate: {
        validator: (value) => value == null || isValidSearchTime(value),
        message: "Search time must use HH:mm",
      },
    },
    timeZone: { type: String, default: null },
    utcOffsetMinutes: { type: Number, default: null },
    availabilityStart: { type: Date, default: null },
    availabilityEnd: { type: Date, default: null },
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
userSearchSchema.index({ isLocked: 1, date: 1, time: 1, created_at: 1 });
userSearchSchema.index({ created_at: 1 }, { expireAfterSeconds: 300 });

const UserSearch = mongoose.model("search", userSearchSchema);

export default UserSearch;
