import mongoose from "mongoose";

const ExploreSchema = new mongoose.Schema(
  {
    category: {
      type: String,
      required: true,
    },
    list: [
      {
        text: {
          type: String,
          required: true,
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
