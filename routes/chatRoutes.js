import { Router } from "express";
import Chat from "../models/ChatScema.js";
import UserDetail from "../models/UserDetailSchema.js";
import { authenticate, loadAuthenticatedUser, requireOwnUser } from "../middleware/auth.js";
import { isValidObjectId } from "../utils/validation.js";

const router = Router();

router.post("/create-chat", authenticate, loadAuthenticatedUser, async (req, res) => {
  try {
    const { user1Id, user2Id } = req.body;
    if (!user1Id || !user2Id) return res.status(400).send("User IDs are required");
    if (!isValidObjectId(user1Id) || !isValidObjectId(user2Id)) return res.status(400).send("Invalid user IDs");
    if (user1Id === user2Id) return res.status(400).send("A user cannot chat with themselves");
    if (![user1Id, user2Id].includes(req.user._id.toString())) return res.status(403).json({ message: "You must be a chat participant" });
    const key = [user1Id, user2Id].sort().join(":");
    const existingChat = await Chat.findOne({ $or: [{ conversationKey: key }, { participants: { $all: [user1Id, user2Id] } }] });
    if (existingChat) {
      if (!existingChat.conversationKey) await Chat.updateOne({ _id: existingChat._id }, { $set: { conversationKey: key } });
      return res.status(200).json(existingChat);
    }
    const newChat = new Chat({ conversationKey: key, participants: [user1Id, user2Id], messages: [] });
    await UserDetail.findByIdAndUpdate(user1Id, { $addToSet: { friends: user2Id } }, { new: true, runValidators: true });
    await UserDetail.findByIdAndUpdate(user2Id, { $addToSet: { friends: user1Id } }, { new: true, runValidators: true });
    await newChat.save();
    res.status(201).json(newChat);
  } catch (error) { console.error(error); res.status(500).send("Server Error"); }
});

router.get("/chat/:user1Id/:user2Id", authenticate, loadAuthenticatedUser, async (req, res) => {
  try {
    const { user1Id, user2Id } = req.params;
    if (!isValidObjectId(user1Id) || !isValidObjectId(user2Id)) return res.status(400).json({ msg: "Invalid user IDs" });
    if (![user1Id, user2Id].includes(req.user._id.toString())) return res.status(403).json({ message: "You must be a chat participant" });
    const chat = await Chat.findOne({ participants: { $all: [user1Id, user2Id] } });
    if (!chat) return res.status(404).json({ msg: "Chat not found" });
    res.json(chat);
  } catch (error) { console.error(error); res.status(500).send("Server Error"); }
});

router.get("/unread-messages/:userId", authenticate, loadAuthenticatedUser, requireOwnUser, async (req, res) => {
  const { userId } = req.params;
  if (!isValidObjectId(userId)) return res.status(400).send("Invalid user ID");
  try {
    const chats = await Chat.find({ participants: userId });
    res.json(chats.map((chat) => ({
      userId: chat.participants.find((id) => id.toString() !== userId),
      count: chat.messages.filter((message) => !message.readBy.includes(userId)).length,
    })));
  } catch (error) { console.error(error); res.status(500).send("Server error"); }
});

export default router;
