import Chat from "../models/ChatScema.js";
import UserDetail from "../models/UserDetailSchema.js";
import { admin } from "../middleware/auth.js";
import { normalizeEmail, isValidObjectId } from "../utils/validation.js";
import { saveMessage } from "../services/chatService.js";

export const registerSocketHandlers = (io, searchService) => {
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error("Authentication required"));
    try {
      const auth = await admin.auth().verifyIdToken(token);
      const email = normalizeEmail(auth.email);
      const user = auth.uid ? await UserDetail.findOne({ $or: [{ firebaseUid: auth.uid }, { email }] }) : null;
      if (!user) return next(new Error("User profile not found"));
      socket.auth = auth;
      socket.user = user;
      next();
    } catch (error) {
      console.error("Socket authentication failed:", error.message);
      next(new Error("Invalid authentication token"));
    }
  });

  io.on("connection", (socket) => {
    console.log("New WebSocket connection", socket.id);
    socket.join(searchService.userRoom(socket.user._id.toString()));
    const eventAllowed = (name, max, windowMs = 60000) => {
      const now = Date.now();
      const state = socket.data.limits || (socket.data.limits = {});
      const entry = state[name] || { started: now, count: 0 };
      if (now - entry.started >= windowMs) { entry.started = now; entry.count = 0; }
      entry.count += 1;
      state[name] = entry;
      return entry.count <= max;
    };

    socket.on("submit_keyword", async ({ userId, query } = {}) => {
      if (!eventAllowed("search", 10)) return socket.emit("error", { message: "Too many searches; try again later." });
      const normalizedQuery = typeof query === "string" ? query.trim().replace(/\s+/g, " ") : "";
      const authenticatedUserId = socket.user._id.toString();
      if (!userId || !normalizedQuery) return socket.emit("error", { message: "UserId and query are required." });
      if (userId !== authenticatedUserId) return socket.emit("error", { message: "You can only search as yourself." });
      if (!isValidObjectId(userId)) return socket.emit("error", { message: "Invalid user ID." });
      if (normalizedQuery.length > 500) return socket.emit("error", { message: "Search query is too long." });
      try { await searchService.startSearch(userId, normalizedQuery, socket); }
      catch (error) { console.error("Error during search submission:", error); socket.emit("error", { message: "An error occurred during the search." }); }
    });

    socket.on("cancel_search", async ({ userId } = {}) => {
      if (userId === socket.user._id.toString() && isValidObjectId(userId)) await searchService.cleanupSearch(userId);
    });
    socket.on("joinChat", async ({ chatId } = {}) => {
      if (!isValidObjectId(chatId)) return;
      if (await Chat.exists({ _id: chatId, participants: socket.user._id })) socket.join(chatId);
    });
    socket.on("leaveChat", ({ chatId } = {}) => { if (isValidObjectId(chatId)) socket.leave(chatId); });
    socket.on("sendMessage", async ({ chatId, message } = {}) => {
      if (!eventAllowed("message", 60) || !chatId || !message || !isValidObjectId(chatId) || !isValidObjectId(message.sender) || !message.content?.trim() || message.sender !== socket.user._id.toString()) return;
      if (!await Chat.exists({ _id: chatId, participants: socket.user._id })) return;
      const updatedChat = await saveMessage(chatId, { sender: message.sender, content: message.content.trim(), readBy: [message.sender] });
      if (!updatedChat) return;
      io.to(chatId).emit("receiveMessage", updatedChat.messages[updatedChat.messages.length - 1]);
      io.emit("updateUnreadCounts");
    });
    socket.on("markAsRead", async ({ chatId, userId } = {}) => {
      if (!isValidObjectId(chatId) || !isValidObjectId(userId) || userId !== socket.user._id.toString()) return;
      try { await Chat.updateMany({ _id: chatId, participants: socket.user._id }, { $addToSet: { "messages.$[].readBy": userId } }); }
      catch (error) { console.error(error); }
      io.emit("updateUnreadCounts");
    });
    socket.on("clearMessages", async ({ chatId } = {}) => {
      if (!isValidObjectId(chatId)) return;
      try { await Chat.updateOne({ _id: chatId, participants: socket.user._id }, { $set: { messages: [] } }); }
      catch (error) { console.error(error); }
      io.emit("messagesCleared");
    });
    socket.on("disconnect", async () => {
      console.log("Socket disconnected");
      await searchService.cleanupSocketSearches(socket.id);
    });
  });
};
