import mongoose from "mongoose";

const chatSchema = new mongoose.Schema(
  {
    participants: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: "user",
      required: true,
    },
    messages: [
      {
        sender: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "user",
          required: true,
        },
        content: {
          type: String,
          required: true,
          trim: true,
          maxlength: 5000,
        },
        timestamp: {
          type: Date,
          default: Date.now,
        },
        readBy: [
          {
            type: mongoose.Schema.Types.ObjectId,
            ref: "user",
            default: [],
          },
        ],
      },
    ],
  },
  {
    collection: "chat",
  }
);

chatSchema.index({ participants: 1 });

const Chat = mongoose.model("chat", chatSchema);
export default Chat;
