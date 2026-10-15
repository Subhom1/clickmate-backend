import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import UserDetail from "./models/UserDetailSchema.js";
import UserSearch from "./models/UserSearchSchema.js";
import Explore from "./models/ExploreSchema.js";
import { spawn } from "child_process";
import { Server as socketIo } from "socket.io";
import http from "http";
import Chat from "./models/ChatScema.js";
import Interest from "./models/InterestSchema.js";
import multer from "multer";
import path from "path";
import { randomUUID } from "crypto";
import { existsSync, readFileSync } from "fs";
// Initialize Express app
const app = express();
const PORT = process.env.PORT || 5051;

const loadLocalEnv = () => {
  if (!existsSync(".env")) return;

  const envFile = readFileSync(".env", "utf8");
  for (const line of envFile.split("\n")) {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith("#")) continue;

    const separatorIndex = trimmedLine.indexOf("=");
    if (separatorIndex === -1) continue;

    const key = trimmedLine.slice(0, separatorIndex).trim();
    const value = trimmedLine.slice(separatorIndex + 1).trim();
    if (key && process.env[key] === undefined) {
      process.env[key] = value.replace(/^["']|["']$/g, "");
    }
  }
};

loadLocalEnv();

const mongoUri = process.env.MONGODB_URI;
const allowedOrigins = process.env.CORS_ORIGIN?.split(",").map((origin) =>
  origin.trim()
).filter(Boolean);

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

const normalizeEmail = (email) =>
  typeof email === "string" ? email.trim().toLowerCase() : "";

const normalizeSearchQuery = (query) =>
  typeof query === "string" ? query.trim().replace(/\s+/g, " ") : "";

if (!mongoUri) {
  throw new Error("MONGODB_URI environment variable is required");
}

const { default: admin } = await import("./FirebaseAdmin.js");

const authenticate = async (req, res, next) => {
  const authorization = req.get("authorization");
  const token = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : null;

  if (!token) {
    return res.status(401).json({ message: "Authentication required" });
  }

  try {
    req.auth = await admin.auth().verifyIdToken(token);
    next();
  } catch (error) {
    console.error("Authentication failed:", error.message);
    res.status(401).json({ message: "Invalid authentication token" });
  }
};

const loadAuthenticatedUser = async (req, res, next) => {
  try {
    const email = normalizeEmail(req.auth?.email);
    if (!email) {
      return res
        .status(403)
        .json({ message: "Authenticated email is required" });
    }

    const user = await UserDetail.findOne({ email });
    if (!user) {
      return res.status(403).json({ message: "User profile not found" });
    }

    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
};

const requireOwnUser = (req, res, next) => {
  if (req.params.userId !== req.user._id.toString()) {
    return res.status(403).json({ message: "You can only access your own user" });
  }
  next();
};

const requireAdmin = (req, res, next) => {
  if (req.auth?.admin !== true && req.auth?.role !== "admin") {
    return res.status(403).json({ message: "Administrator access required" });
  }
  next();
};

// Middleware
app.use(express.json({ limit: "100kb" }));
app.use(express.static("./public")); // To serve images statically
app.use(
  cors({
    origin: allowedOrigins?.length ? allowedOrigins : false,
  })
);

// Create HTTP server
const server = http.createServer(app);

// Attach WebSocket server to the HTTP server
const io = new socketIo(server, {
  cors: {
    origin: allowedOrigins?.length ? allowedOrigins : false,
  },
});

// To register a user
app.post("/register", async (req, res) => {
  const { name, email } = req.body;
  const normalizedEmail = normalizeEmail(email);
  const normalizedName = typeof name === "string" ? name.trim() : "";

  if (!normalizedName || !normalizedEmail) {
    return res.status(400).send({ data: "Name and email are required" });
  }

  try {
    const oldUser = await UserDetail.findOne({ email: normalizedEmail });
    if (oldUser) return res.status(409).send({ data: "User already exists!" });

    const newUser = await UserDetail.create({
      fullname: normalizedName.toLowerCase(),
      email: normalizedEmail,
      created_at: new Date(),
      updated_at: new Date(),
    });
    res.status(201).send({ status: "ok", statusCode: 201, data: newUser });
  } catch (err) {
    res.status(500).send({ status: "error", data: err.message });
  }
});
//===============
// User Operations
// Fetch user's details by email
app.get("/user/:email", authenticate, async (req, res) => {
  const email = normalizeEmail(req.params.email);
  if (email !== normalizeEmail(req.auth.email)) {
    return res.status(403).json({ message: "You can only access your own user" });
  }

  try {
    const user = await UserDetail.findOne({ email })
      .populate("interests")
      .populate("friends");

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json(user);
  } catch (error) {
    console.error("Error fetching user:", error);
    res.status(500).json({ message: "Unable to fetch user" });
  }
});
//To fetch all the friends of a user
app.get(
  "/users/:userId/friends",
  authenticate,
  loadAuthenticatedUser,
  requireOwnUser,
  async (req, res) => {
  try {
    const { userId } = req.params;
    if (!isValidObjectId(userId)) {
      return res.status(400).json({ message: "Invalid user ID" });
    }

    // Find the user by ID and populate the friends field
    const user = await UserDetail.findById(userId).populate(
      "friends",
      "fullname email bio interests"
    );

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Return the list of friends
    res.json(user.friends);
  } catch (error) {
    console.error("Error fetching friends:", error);
    res.status(500).json({ message: "Unable to fetch friends" });
  }
  }
);
//To update the user's details
app.patch(
  "/user/:userId",
  authenticate,
  loadAuthenticatedUser,
  requireOwnUser,
  async (req, res) => {
  try {
    const userId = req.params.userId;
    if (!isValidObjectId(userId)) {
      return res.status(400).json({ message: "Invalid user ID" });
    }

    const updateFields = {};
    // Dynamically add fields to the update object if they are present in the request body
    if (req.body.fullname) {
      updateFields.fullname = req.body.fullname;
    }

    // Update the bio field even if it's an empty string
    if (req.body.bio !== undefined) {
      updateFields.bio = req.body.bio == "" ? "No Bio" : req.body.bio;
    }

    if (req.body.interests) {
      updateFields.interests = req.body.interests;
    }

    // Always update the timestamp
    updateFields.updated_at = new Date();

    // Check if there are any fields to update
    if (Object.keys(updateFields).length === 0) {
      return res.status(400).json({ message: "No fields provided for update" });
    }

    // Find the user by ID and update the specified fields
    const updatedUser = await UserDetail.findByIdAndUpdate(
      userId,
      updateFields,
      { new: true, runValidators: true } // Return the updated document and validate input
    )
      .populate("interests")
      .populate("friends");

    if (!updatedUser) {
      return res.status(404).json({ message: "User not found" });
    }

    res.status(200).json(updatedUser);
  } catch (error) {
    console.error("Error updating user:", error);
    res.status(500).json({ message: "Unable to update user" });
  }
  }
);
//Delete user
app.delete(
  "/deleteUser/:uid/",
  authenticate,
  loadAuthenticatedUser,
  async (req, res) => {
  const { uid } = req.params;

  if (!isValidObjectId(uid)) {
    return res.status(400).send({ message: "Invalid user ID" });
  }
  if (uid !== req.user._id.toString()) {
    return res.status(403).json({ message: "You can only delete your own user" });
  }

  try {
    await admin.auth().deleteUser(req.auth.uid);
    const result = await UserDetail.deleteOne({ _id: uid });

    if (result.deletedCount === 1) {
      res.status(200).send({
        message: "User deleted successfully from Firebase and MongoDB",
      });
    } else {
      res.status(404).send({ message: "User not found in MongoDB" });
    }
  } catch (error) {
    console.error("Error deleting user:", error);
    res
      .status(500)
      .send({ message: "Error deleting user" });
  }
  }
);
//Get all interests
app.get("/interests", async (req, res) => {
  try {
    const interests = await Interest.find();
    res.status(200).json(interests);
  } catch (error) {
    console.error("Error fetching interests:", error);
    res.status(500).json({ message: "Unable to fetch interests" });
  }
});

const ongoingSearches = new Map();
const matchList = new Map();

const searchTimeoutDuration = 30000; // 30 seconds
const checkInterval = 1000; // 1 second
const minimumSimilarityScore = 0.5;

const runPythonScript = async (text1, text2) => {
  return new Promise((resolve, reject) => {
    const childProcess = spawn(process.env.PYTHON_BIN || "python3", [
      "scripts/calculate_similarity.py",
      text1,
      text2,
    ]);

    let result = "";
    let error = "";

    childProcess.stdout.on("data", (data) => {
      result += data.toString();
    });

    childProcess.stderr.on("data", (data) => {
      error += data.toString();
    });

    childProcess.on("close", (code) => {
      if (code === 0) {
        try {
          const jsonResult = JSON.parse(result);
          resolve(jsonResult);
        } catch (parseError) {
          reject(`Invalid JSON output: ${result}`);
        }
      } else {
        reject(`Error: ${error}`);
      }
    });
  });
};

const lockUser = async (userId) => {
  const user = await UserSearch.findOneAndUpdate(
    { userId, isLocked: { $ne: true } },
    { isLocked: true },
    { new: true }
  );
  return user != null;
};

const unlockUser = async (userId) => {
  await UserSearch.findOneAndUpdate({ userId }, { isLocked: false });
};

const cleanupSearch = async (userId) => {
  const currentSearch = ongoingSearches.get(userId);
  if (currentSearch?.timer) {
    clearTimeout(currentSearch.timer);
  }
  currentSearch?.cancel?.();
  await UserSearch.deleteOne({ userId });
  await unlockUser(userId);
  ongoingSearches.delete(userId);
};

const clearMatch = (userId) => {
  const partnerId = matchList.get(userId)?.match;
  matchList.delete(userId);
  if (partnerId) {
    matchList.delete(partnerId);
  }
  return partnerId;
};

const lockMatchPair = async (userId, otherUserId) => {
  const selfLocked = await lockUser(userId);
  if (!selfLocked) return false;

  const otherLocked = await lockUser(otherUserId);
  if (!otherLocked) {
    await unlockUser(userId);
    return false;
  }

  return true;
};

const findMatch = (userId, query, socket) => {
  console.log("findMatch function called for User ID:", userId);
  let cancelled = false;
  let timer = null;
  const similarityCache = new Map();

  const cancel = () => {
    cancelled = true;
    if (timer) {
      clearTimeout(timer);
    }
  };

  const scheduleNextCheck = () => {
    timer = setTimeout(checkForMatches, checkInterval);
    const currentSearch = ongoingSearches.get(userId);
    if (currentSearch) {
      currentSearch.timer = timer;
    }
  };

  let attempts = 0;
  const maxAttempts = searchTimeoutDuration / checkInterval;

  const checkForMatches = async () => {
    if (matchList.has(userId) || cancelled) return;
    attempts++;
    try {
      const allOtherQueries = await UserSearch.find({
        isLocked: false,
        userId: { $ne: userId },
      })
        .sort({ created_at: 1 })
        .lean(); // Used lean() to improve performance by returning plain JavaScript objects

      console.log(
        `Attempt ${attempts}: Found ${allOtherQueries.length} other queries`
      );

      let bestMatch = null;
      let highestSimilarity = 0;

      for (let q of allOtherQueries) {
        // Looping through all the queries and running the python script
        const otherUserId = q.userId.toString();
        const isMatchExist = matchList.has(otherUserId);
        if (isMatchExist) continue;
        if (!ongoingSearches.has(otherUserId)) continue;

        try {
          const candidateTimestamp = q.created_at
            ? new Date(q.created_at).getTime()
            : 0;
          const cacheKey = `${otherUserId}:${candidateTimestamp}`;
          const result =
            similarityCache.get(cacheKey) ||
            (await runPythonScript(q.query, query));
          similarityCache.set(cacheKey, result);
          const similarity = result.similarity_score;
          if (typeof similarity !== "number") continue;

          console.log(
            `Comparing User ID ${userId} with User ID ${otherUserId}: Similarity = ${similarity}`
          );

          if (similarity > highestSimilarity) {
            bestMatch = otherUserId;
            highestSimilarity = similarity;
          }
        } catch (error) {
          console.error("Error running Python script:", error);
        }
      }
      if (
        bestMatch &&
        highestSimilarity >= minimumSimilarityScore &&
        !matchList.has(bestMatch) &&
        !matchList.has(userId) &&
        !cancelled
      ) {
        const matchedSocket = ongoingSearches.get(bestMatch)?.socket;
        const selfSocket = ongoingSearches.get(userId)?.socket;

        if (!matchedSocket || !selfSocket) {
          await cleanupSearch(bestMatch);
          scheduleNextCheck();
          return;
        }

        const locked = await lockMatchPair(userId, bestMatch);
        if (!locked) {
          scheduleNextCheck();
          return;
        }

        if (selfSocket) {
          matchedSocket?.emit("search_update", {
            matches: {
              user: await UserDetail.findOne({ _id: userId }),
              similarity: highestSimilarity,
            },

            message: "Search result found",
          });
        }
        if (matchedSocket) {
          selfSocket?.emit("search_update", {
            matches: {
              user: await UserDetail.findOne({ _id: bestMatch }),
              similarity: highestSimilarity,
            },

            message: "Search result found",
          });
        }
        matchList.set(userId, { match: bestMatch });
        matchList.set(bestMatch, { match: userId });
        await UserSearch.deleteOne({ userId });
        await UserSearch.deleteOne({ userId: bestMatch });
        ongoingSearches.delete(userId);
        ongoingSearches.delete(bestMatch);
        console.log(
          `Match found and users ${userId} and ${bestMatch} removed from search`
        );
        return;
      }

      if (attempts < maxAttempts && !cancelled) {
        scheduleNextCheck();
      } else {
        if (cancelled) {
          socket.emit("search_update", {
            cancel: true,
            message: "Search has been cancelled",
          });
        } else {
          socket.emit("search_update", {
            matches: null,
            message: "No result found",
          });
        }
        await UserSearch.deleteOne({ userId });
        await unlockUser(userId);
        ongoingSearches.delete(userId);
        console.log(
          "Timeout reached, no match found",
          "matchList:",
          matchList,
          "ongoingSearches:",
          ongoingSearches
        );
      }
    } catch (err) {
      console.error("Error during match checking:", err);
      socket.emit("error", {
        message: "An error occurred while checking for matches.",
      });
      await unlockUser(userId);
      ongoingSearches.delete(userId);
    }
  };

  timer = setTimeout(checkForMatches, 0);
  return { cancel, timer };
};
app.post("/create-chat", authenticate, loadAuthenticatedUser, async (req, res) => {
  try {
    const { user1Id, user2Id } = req.body;
    // Validate request
    if (!user1Id || !user2Id) {
      return res.status(400).send("User IDs are required");
    }
    if (!isValidObjectId(user1Id) || !isValidObjectId(user2Id)) {
      return res.status(400).send("Invalid user IDs");
    }
    if (user1Id === user2Id) {
      return res.status(400).send("A user cannot chat with themselves");
    }
    if (![user1Id, user2Id].includes(req.user._id.toString())) {
      return res.status(403).json({ message: "You must be a chat participant" });
    }
    // Guard clause: Check if a chat thread already exists between the two users
    const existingChat = await Chat.findOne({
      participants: { $all: [user1Id, user2Id] },
    });
    if (existingChat) {
      return res.status(200).json(existingChat); // Return the existing chat thread
    }
    // Create a new chat thread if no existing thread is found
    const newChat = new Chat({
      participants: [user1Id, user2Id],
      messages: [],
    });
    // Update the friend list of both users
    await UserDetail.findByIdAndUpdate(
      user1Id,
      { $addToSet: { friends: user2Id } }, // Add user2Id to user1's friends array if it doesn't already exist
      { new: true, runValidators: true } // Return the updated document and validate input
    );

    await UserDetail.findByIdAndUpdate(
      user2Id,
      { $addToSet: { friends: user1Id } }, // Add user1Id to user2's friends array if it doesn't already exist
      { new: true, runValidators: true } // Return the updated document and validate input
    );

    await newChat.save();

    res.status(201).json(newChat); // Send back the created chat thread
  } catch (e) {
    console.error(e);
    res.status(500).send("Server Error");
  }
});
app.get(
  "/chat/:user1Id/:user2Id",
  authenticate,
  loadAuthenticatedUser,
  async (req, res) => {
  try {
    const { user1Id, user2Id } = req.params;
    if (!isValidObjectId(user1Id) || !isValidObjectId(user2Id)) {
      return res.status(400).json({ msg: "Invalid user IDs" });
    }
    if (![user1Id, user2Id].includes(req.user._id.toString())) {
      return res.status(403).json({ message: "You must be a chat participant" });
    }

    // Find the chat that includes both user1Id and user2Id in participants
    const chat = await Chat.findOne({
      participants: { $all: [user1Id, user2Id] },
    });

    if (!chat) {
      return res.status(404).json({ msg: "Chat not found" });
    }

    res.json(chat); // Return the found chat
  } catch (error) {
    console.error(error);
    res.status(500).send("Server Error");
  }
  }
);

const saveMessage = async (chatId, message) => {
  try {
    const updatedChat = await Chat.findByIdAndUpdate(
      chatId,
      { $push: { messages: message } }, // Add the new message to the messages array
      { new: true } // Return the updated document
    );
    return updatedChat;
  } catch (error) {
    console.error(error.message);
    throw new Error("Error saving message");
  }
};
// Fetch un-read message of users
app.get(
  "/unread-messages/:userId",
  authenticate,
  loadAuthenticatedUser,
  requireOwnUser,
  async (req, res) => {
  const { userId } = req.params;
  if (!isValidObjectId(userId)) {
    return res.status(400).send("Invalid user ID");
  }

  try {
    // Find all chats where the current user is a participant
    const chats = await Chat.find({ participants: userId });

    // Map through each chat to calculate unread messages count and the other user's ID
    const unreadMessagesCount = chats.map((chat) => {
      // Identify the other participant's user ID
      const otherUserId = chat.participants.find(
        (id) => id.toString() !== userId
      );

      // Count the number of messages that have not been read by the current user
      const count = chat.messages.filter(
        (message) => !message.readBy.includes(userId)
      ).length;

      return {
        userId: otherUserId,
        count,
      };
    });

    res.json(unreadMessagesCount);
  } catch (error) {
    console.error(error);
    res.status(500).send("Server error");
  }
  }
);

// Initialize upload variable
const upload = multer({
  // Set storage engine using Multer
  storage: multer.diskStorage({
    destination: "./public/uploads/",
    filename: function (req, file, cb) {
      cb(
        null,
        `${file.fieldname}-${Date.now()}-${randomUUID()}${path.extname(
          file.originalname
        )}`
      );
    },
  }),
  limits: { fileSize: 5000000 }, // 5MB file size limit
  fileFilter: function (req, file, cb) {
    checkFileType(file, cb);
  },
}).array("images", 10); // 'image' is the name of our file input field  // Accept up to 10 images

// Check File Type
function checkFileType(file, cb) {
  const allowedTypes = new Map([
    [".jpeg", "image/jpeg"],
    [".jpg", "image/jpeg"],
    [".png", "image/png"],
    [".gif", "image/gif"],
  ]);
  const extension = path.extname(file.originalname).toLowerCase();
  const mimetype = allowedTypes.get(extension);

  if (mimetype === file.mimetype) {
    return cb(null, true);
  } else {
    cb(new Error("Only JPEG, PNG, and GIF images are allowed"));
  }
}
// Route to add items to an existing list in a document
app.post(
  "/add-items/:categoryId",
  authenticate,
  requireAdmin,
  upload,
  async (req, res) => {
  const { categoryId } = req.params;
  if (!isValidObjectId(categoryId)) {
    return res.status(400).send({ message: "Invalid category ID" });
  }

  const files = req.files;
  const items = req.body.items;

  if (!items) {
    return res.status(400).send({ message: "No items provided." });
  }

  try {
    const parsedItems = JSON.parse(items);
    if (!Array.isArray(parsedItems)) {
      return res.status(400).send({ message: "Items must be an array." });
    }
    if (parsedItems.length === 0 || parsedItems.length > 10) {
      return res
        .status(400)
        .send({ message: "Items must contain between 1 and 10 entries." });
    }
    if (!files || files.length !== parsedItems.length) {
      return res
        .status(400)
        .send({ message: "Each item must include exactly one image." });
    }

    const itemData = parsedItems.map((item, index) => {
      const text = typeof item.text === "string" ? item.text.trim() : "";
      if (!text || text.length > 500) {
        throw new Error("Each item text must be between 1 and 500 characters");
      }
      return {
        text,
        imgUrl: `/uploads/${files[index].filename}`,
      };
    });

    const updatedExplore = await Explore.findByIdAndUpdate(
      categoryId,
      { $push: { list: { $each: itemData } } },
      { new: true, upsert: true }
    );

    res.status(200).json(updatedExplore);
  } catch (error) {
    console.error("Error adding items:", error);
    res.status(400).send({ message: error.message });
  }
  }
);
// POST route to create a new category
app.post(
  "/add-explore-category",
  authenticate,
  requireAdmin,
  (req, res) => {
    const category =
      typeof req.body.category === "string" ? req.body.category.trim() : "";

    if (!category || category.length > 100) {
        return res.status(400).json({ message: "Category is required." });
    }

    const newExplore = new Explore({
        category,
        list: [],
    });

    newExplore.save()
      .then((explore) => res.status(201).json(explore))
      .catch((error) => {
        console.error("Error saving the category:", error);
        res.status(500).json({ message: "Unable to save the category" });
      });
  }
);
//Get all interests
app.get("/explore", async (req, res) => {
  try {
    const explore = await Explore.find();
    res.status(200).json(explore);
  } catch (error) {
    console.error("Error fetching explore categories:", error);
    res.status(500).json({ message: "Unable to fetch explore categories" });
  }
});

//=========== All socket operations
io.use(async (socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) {
    return next(new Error("Authentication required"));
  }

  try {
    const auth = await admin.auth().verifyIdToken(token);
    const email = normalizeEmail(auth.email);
    const user = email ? await UserDetail.findOne({ email }) : null;
    if (!user) {
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
  socket.on("submit_keyword", async ({ userId, query } = {}) => {
    const normalizedQuery = normalizeSearchQuery(query);
    const authenticatedUserId = socket.user._id.toString();

    if (!userId || !normalizedQuery) {
      socket.emit("error", { message: "UserId and query are required." });
      return;
    }
    if (userId !== authenticatedUserId) {
      socket.emit("error", { message: "You can only search as yourself." });
      return;
    }
    if (!isValidObjectId(userId)) {
      socket.emit("error", { message: "Invalid user ID." });
      return;
    }
    if (normalizedQuery.length > 500) {
      socket.emit("error", { message: "Search query is too long." });
      return;
    }

    if (matchList.has(userId)) {
      clearMatch(userId);
    }

    try {
      await cleanupSearch(userId);
      await UserSearch.findOneAndUpdate(
        { userId },
        { query: normalizedQuery, created_at: new Date(), isLocked: false },
        { upsert: true }
      );

      const search = findMatch(userId, normalizedQuery, socket);
      ongoingSearches.set(userId, { socket, ...search });
    } catch (error) {
      console.error("Error during search submission:", error);
      socket.emit("error", { message: "An error occurred during the search." });
    }
  });
  socket.on("cancel_search", async ({ userId } = {}) => {
    if (userId !== socket.user._id.toString()) return;
    if (!isValidObjectId(userId)) return;

    await cleanupSearch(userId);
    if (matchList.has(userId)) {
      const partnerId = clearMatch(userId);
      if (partnerId) {
        await unlockUser(partnerId);
      }
      ongoingSearches.get(partnerId)?.socket?.emit("search_update", {
        matches: null,
        message: "No partner found",
      });
    }
  });
  socket.on("joinChat", async ({ chatId } = {}) => {
    if (!isValidObjectId(chatId)) return;
    const chat = await Chat.exists({
      _id: chatId,
      participants: socket.user._id,
    });
    if (chat) {
      socket.join(chatId);
    }
  });
  socket.on("leaveChat", ({ chatId } = {}) => {
    if (!isValidObjectId(chatId)) return;
    socket.leave(chatId);
  });
  // When a message is sent
  socket.on("sendMessage", async ({ chatId, message } = {}) => {
    if (!chatId || !message || !isValidObjectId(chatId)) return;
    if (!isValidObjectId(message.sender) || !message.content?.trim()) return;
    if (message.sender !== socket.user._id.toString()) return;

    const chat = await Chat.exists({
      _id: chatId,
      participants: socket.user._id,
    });
    if (!chat) return;

    const newMessage = {
      sender: message.sender,
      content: message.content.trim(),
      readBy: [message.sender],
    };

    const updatedChat = await saveMessage(chatId, newMessage);
    if (!updatedChat) return;

    io.to(chatId).emit(
      "receiveMessage",
      updatedChat.messages[updatedChat.messages.length - 1]
    );
    // Emit event to update unread counts
    io.emit("updateUnreadCounts");
  });
  // When marking messages as read
  socket.on("markAsRead", async ({ chatId, userId } = {}) => {
    if (!isValidObjectId(chatId) || !isValidObjectId(userId)) return;
    if (userId !== socket.user._id.toString()) return;

    try {
      await Chat.updateMany(
        { _id: chatId, participants: socket.user._id },
        { $addToSet: { "messages.$[].readBy": userId } }
      );
    } catch (error) {
      console.error(error);
    }
    // Emit event to update unread counts after marking as read
    io.emit("updateUnreadCounts");
  });
  // Clear all messages by chatId
  socket.on("clearMessages", async ({ chatId } = {}) => {
    if (!isValidObjectId(chatId)) return;

    try {
      await Chat.updateOne(
        { _id: chatId, participants: socket.user._id }, // Only participants can clear a chat
        { $set: { messages: [] } } // Set the messages array to an empty array
      );
    } catch (error) {
      console.error(error);
    }

    // Optionally, emit an event to notify the client that the messages have been cleared
    io.emit("messagesCleared");
  });
  socket.on("disconnect", async () => {
    console.log("Socket disconnected");
    const disconnectedSearches = [...ongoingSearches.entries()].filter(
      ([, search]) => search.socket.id === socket.id
    );
    await Promise.all(
      disconnectedSearches.map(async ([userId]) => {
        const partnerId = clearMatch(userId);
        await cleanupSearch(userId);
        if (partnerId) {
          await unlockUser(partnerId);
          ongoingSearches.get(partnerId)?.socket?.emit("search_update", {
            matches: null,
            message: "No partner found",
          });
        }
      })
    );
  });
});

app.get("/health", (req, res) => {
  const databaseReady = mongoose.connection.readyState === 1;
  res.status(databaseReady ? 200 : 503).json({
    status: databaseReady ? "ok" : "degraded",
    database: databaseReady ? "connected" : "disconnected",
  });
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  console.error("Unhandled request error:", error);
  res.status(error.statusCode || 500).json({
    message: error.statusCode ? error.message : "Internal server error",
  });
});

const startServer = async () => {
  await mongoose.connect(mongoUri);
  console.log("Connected to MongoDB");

  server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
};

startServer().catch((error) => {
  console.error("Unable to start backend:", error.message);
  process.exitCode = 1;
});

const shutdown = async (signal) => {
  console.log(`${signal} received, shutting down`);
  await mongoose.disconnect();
  server.close(() => process.exit(0));
};

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));

// Endpoint to add interests //ONLY AS A ADMIN IF I WANT TO ADD ANY NEW INTEREST TO THE DB
// app.post("/add-interest", async (req, res) => {
//   const { interest } = req.body; // Extract the interest array from the request body

//   if (!Array.isArray(interest) || interest.length === 0) {
//     return res
//       .status(400)
//       .json({ message: "Interest array is required and must be non-empty" });
//   }

//   // Ensure all items in the array have the required 'text' field
//   const missingTextFields = interest.filter((item) => !item.text);
//   if (missingTextFields.length > 0) {
//     return res
//       .status(400)
//       .json({ message: "Each interest object must contain a 'text' field" });
//   }

//   // Extract the texts for easy processing
//   const interestTexts = interest.map((item) => item.text);

//   try {
//     // Find existing interests
//     const existingInterests = await Interest.find({
//       text: { $in: interestTexts },
//     }).lean();
//     const existingTexts = new Set(existingInterests.map((item) => item.text));

//     // Determine new interests to insert
//     const newInterests = interest.filter(
//       (item) => !existingTexts.has(item.text)
//     );

//     // Insert new interests
//     if (newInterests.length > 0) {
//       const result = await Interest.insertMany(newInterests, {
//         ordered: false,
//       });
//       res.status(201).json({
//         message: `${result.length} new interests added`,
//         added: result,
//       });
//     } else {
//       res.status(200).json({ message: "No new interests to add" });
//     }
//   } catch (error) {
//     // Log the full error for debugging
//     console.error("Error inserting interests:", error);

//     // Handle errors, such as validation errors
//     if (error.code === 11000) {
//       // Duplicate key error code
//       res.status(409).json({ message: "One or more interests already exist" });
//     } else {
//       res.status(500).json({ message: error.message });
//     }
//   }
// });
