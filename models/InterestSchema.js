import mongoose from "mongoose";

const InterestSchema = new mongoose.Schema(
  {
    interest: [String],
  },
  {
    collection: "interest",
  }
);

const Interest = mongoose.model("interest", InterestSchema);

export default Interest;
