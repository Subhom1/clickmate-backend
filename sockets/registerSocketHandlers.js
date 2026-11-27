import Chat from "../models/ChatScema.js";
import { searchAvailability } from "../utils/searchAvailability.js";
import UserDetail from "../models/UserDetailSchema.js";
import { admin } from "../middleware/auth.js";
import { normalizeEmail, isValidObjectId, isValidSearchDate, isValidSearchTime } from "../utils/validation.js";
import { saveMessage } from "../services/chatService.js";

export const registerSocketHandlers = (io, searchService) => {
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error("Authentication required"));
    try {
      const auth = await admin.auth().verifyIdToken(token);
      const email = normalizeEmail(auth.email);
      // Find the Firebase account first; email supports older, unlinked profiles.
      let user = auth.uid ? await UserDetail.findOne({ firebaseUid: auth.uid }) : null;
      if (!user && email) user = await UserDetail.findOne({ email });
      if (!user || (user.firebaseUid && user.firebaseUid !== auth.uid)) {
        return next(new Error("User profile not found"));
      }
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
    // Limit each event type separately for this socket connection.
    const eventAllowed = (name, max, windowMs = 60000) => {
      const now = Date.now();
      const state = socket.data.limits || (socket.data.limits = {});
      const entry = state[name] || { started: now, count: 0 };
      if (now - entry.started >= windowMs) { entry.started = now; entry.count = 0; }
      entry.count += 1;
      state[name] = entry;
      return entry.count <= max;
    };

    socket.on("submit_keyword", async ({ userId, query, date, time, timeZone, utcOffsetMinutes } = {}) => {
      if (!eventAllowed("search", 10)) return socket.emit("error", { message: "Too many searches; try again later." });
      const normalizedQuery = typeof query === "string" ? query.trim().replace(/\s+/g, " ") : "";
      const authenticatedUserId = socket.user._id.toString();
      if (!userId || !normalizedQuery) return socket.emit("error", { message: "UserId and query are required." });
      if (userId !== authenticatedUserId) return socket.emit("error", { message: "You can only search as yourself." });
      if (!isValidObjectId(userId)) return socket.emit("error", { message: "Invalid user ID." });
      if (normalizedQuery.length > 500) return socket.emit("error", { message: "Search query is too long." });
      if (date != null && !isValidSearchDate(date)) return socket.emit("error", { message: "Invalid date. Use YYYY-MM-DD." });
      if (time != null && !isValidSearchTime(time)) return socket.emit("error", { message: "Invalid time. Use HH:mm." });
      const schedule = { date: date ?? null, time: time ?? null };
      // Validate timezone details before replacing the user's active search.
      if (timeZone != null || utcOffsetMinutes != null) {
        try {
          searchAvailability({ date, time, timeZone, utcOffsetMinutes });
          Object.assign(schedule, { timeZone, utcOffsetMinutes });
        } catch {
          return socket.emit("error", { message: "Invalid time zone or local time and UTC offset." });
        }
      }
      try { await searchService.startSearch(userId, normalizedQuery, socket, schedule); }
      catch (error) { console.error("Error during search submission:", error); socket.emit("error", { message: "An error occurred during the search." }); }
    });

    socket.on("cancel_search", async ({ userId } = {}) => {
      if (userId === socket.user._id.toString() && isValidObjectId(userId)) await searchService.cleanupSearch(userId);
    });
    socket.on("joinChat", async ({ chatId } = {}) => {
      // Knowing a chat ID is not enough; the user must belong to that chat.
      if (!isValidObjectId(chatId)) return;
      if (await Chat.exists({ _id: chatId, participants: socket.user._id })) socket.join(chatId);
    });
    socket.on("leaveChat", ({ chatId } = {}) => { if (isValidObjectId(chatId)) socket.leave(chatId); });
    socket.on("sendMessage", async ({ chatId, message } = {}) => {
      const content = typeof message?.content === "string" ? message.content.trim() : "";
      if (!eventAllowed("message", 60) || !chatId || !message || !isValidObjectId(chatId) || !isValidObjectId(message.sender) || !content || content.length > 5000 || message.sender !== socket.user._id.toString()) return;
      if (!await Chat.exists({ _id: chatId, participants: socket.user._id })) return;
      const updatedChat = await saveMessage(chatId, { sender: message.sender, content, readBy: [message.sender] });
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
