import mongoose from "mongoose";

const InterestSchema = new mongoose.Schema(
  {
    text: { type: String, unique: true, required: true },
  },
  {
    collection: "interest",
  }
);

const Interest = mongoose.model("interest", InterestSchema);

export default Interest;
