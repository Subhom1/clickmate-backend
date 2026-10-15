import mongoose from "mongoose";

const ExploreSchema = new mongoose.Schema(
  {
    category: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    list: [
      {
        text: {
          type: String,
          required: true,
          trim: true,
          maxlength: 500,
        },
        imgUrl: {
          type: String,
          required: true,
        },
      },
    ],
  },
  {
    collection: "explore",
  }
);

const Explore = mongoose.model("Explore", ExploreSchema);

export default Explore;
