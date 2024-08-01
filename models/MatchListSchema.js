import mongoose from "mongoose";

const MatchListSchema = new mongoose.Schema(
  {
    user1: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: "user",
    },
    user2: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: "user",
    },
    similarity:{
      type: Number
    },
    created_at: {
      type: Date,
      default: Date.now,
    },
  },
  {
    collection: "match_list",
  }
);

const MatchList = mongoose.model("match_list", MatchListSchema);

export default MatchList;
