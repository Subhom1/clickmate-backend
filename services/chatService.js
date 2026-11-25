import Chat from "../models/ChatScema.js";

export const saveMessage = async (chatId, message) => {
  // Append in MongoDB so simultaneous messages do not overwrite each other.
  try {
    return await Chat.findByIdAndUpdate(
      chatId,
      { $push: { messages: message } },
      { new: true, runValidators: true }
    );
  } catch (error) {
    console.error(error.message);
    throw new Error("Error saving message");
  }
};
