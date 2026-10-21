import Chat from "../models/ChatScema.js";

export const saveMessage = async (chatId, message) => {
  try {
    return await Chat.findByIdAndUpdate(
      chatId,
      { $push: { messages: message } },
      { new: true }
    );
  } catch (error) {
    console.error(error.message);
    throw new Error("Error saving message");
  }
};
