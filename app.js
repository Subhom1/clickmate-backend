import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import UserDetail from "./models/UserDetailSchema.js";
import UserSearch from "./models/UserSearchSchema.js";
import Explore from "./models/ExploreSchema.js";
import { spawn } from "child_process"; // kept for legacy calculate_similarity.py — no longer used for matching
import axios from "axios";
import { Server as socketIo } from "socket.io";
import http from "http";
import Chat from "./models/ChatScema.js";
import Interest from "./models/InterestSchema.js";
import multer from "multer";
import path from "path";
import { uri } from "./Secret.js";
import {
  getContextEmbedding,
  cosineSimilarity,
} from "./scripts/ChatGPTContext.js";
import "dotenv/config";

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 5051;
// Configurable matching thresholds — override via environment variables
const SIMILARITY_THRESHOLD = parseFloat(process.env.SIMILARITY_THRESHOLD ?? "0.5");
const PYTHON_TIMEOUT_MS = parseInt(process.env.PYTHON_TIMEOUT_MS ?? "5000");

// Middleware
app.use(express.json());
app.use(express.static("./public")); // To serve images statically
app.use(cors());

// Create HTTP server
const server = http.createServer(app);

// Attach WebSocket server to the HTTP server
const io = new socketIo(server);

mongoose
  .connect(uri)
  .then(async () => {
    console.log("Connected to MongoDB");
    // Clear any locks left over from a previous crashed or restarted session
    const cleared = await UserSearch.updateMany({}, { isLocked: false });
    console.log(`Cleared ${cleared.modifiedCount} stale search lock(s) on startup`);
  })
  .catch((err) => console.error("Error connecting to MongoDB:", err));

// To register a user
app.post("/register", async (req, res) => {
  const { name, email } = req.body;

  const oldUser = await UserDetail.findOne({ email });
  if (oldUser) return res.status(409).send({ data: "User already exists!" });
  try {
    const newUser = await UserDetail.create({
      fullname: name.toLowerCase(),
      email: email.toLowerCase(),
      created_at: Date(),
      updated_at: Date(),
    });
    res.status(201).send({ status: "ok", statusCode: 200, data: newUser });
  } catch (err) {
    res.status(500).send({ status: "error", data: err.res });
  }
});
//===============
// User Operations
// Fetch user's details by email
app.get("/user/:email", async (req, res) => {
  const { email } = req.params;
  try {
    const user = await UserDetail.findOne({ email })
      .populate("interests")
      .populate("friends");

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json(user);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});
//To fetch all the friends of a user
app.get("/users/:userId/friends", async (req, res) => {
  try {
    const { userId } = req.params;

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
    res.status(500).json({ message: error.message });
  }
});
//To update the user's details
app.patch("/user/:userId", async (req, res) => {
  try {
    const userId = req.params.userId;
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
    res.status(500).json({ message: error.message });
  }
});
//Delete user
app.delete("/deleteUser/:uid/", async (req, res) => {
  const { uid } = req.params;

  try {
    // Delete user from MongoDB using Mongoose
    const result = await UserDetail.deleteOne({ _id: uid });

    if (result.deletedCount === 1) {
      // Delete user from Firebase Auth
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
      .send({ message: "Error deleting user", error: error.message });
  }
});
//Get all interests
app.get("/interests", async (req, res) => {
  try {
    const interests = await Interest.find();
    res.status(200).json(interests);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

const ongoingSearches = new Map();
const matchList = new Map();

const searchTimeoutDuration = 30000; // 30 seconds absolute deadline

// Issue 11: event bus — new searchers wake all existing workers immediately
import { EventEmitter } from "events";
const matchingBus = new EventEmitter();
matchingBus.setMaxListeners(500); // allow many concurrent searchers

// Issue 9: HTTP call to the persistent FastAPI similarity microservice.
// The service loads the transformer model once on startup, eliminating the
// per-comparison cold-start cost of spawning a new python3 process each time.
const SIMILARITY_SERVICE_URL =
  process.env.SIMILARITY_SERVICE_URL ?? "http://127.0.0.1:8001/similarity";

const runSimilarityService = async (text1, text2) => {
  const response = await axios.post(SIMILARITY_SERVICE_URL, { text1, text2 });
  return response.data; // { similarity_score: number }
};

const runChatGPTSimilarity = async (text1, text2) => {
  const emb1 = await getContextEmbedding(text1);
  const emb2 = await getContextEmbedding(text2);
  return cosineSimilarity(emb1, emb2);
};

// Wraps a promise with a hard timeout so a hung subprocess never stalls a poll cycle
const withTimeout = (promise, ms) =>
  Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Operation timed out after ${ms}ms`)), ms)
    ),
  ]);

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

// Issue 14: Jaccard overlap coefficient — returns 0.0–1.0 representing the
// fraction of shared interests between two users' interest ID sets.
const computeInterestOverlap = (interests1, interests2) => {
  if (!interests1?.length || !interests2?.length) return 0;
  const set1 = new Set(interests1.map((id) => id.toString()));
  const set2 = new Set(interests2.map((id) => id.toString()));
  const intersection = [...set1].filter((id) => set2.has(id)).length;
  const union = new Set([...set1, ...set2]).size;
  return union === 0 ? 0 : intersection / union;
};

// Weighting for blended score: query semantic similarity vs interest overlap
const QUERY_WEIGHT = parseFloat(process.env.QUERY_WEIGHT ?? "0.7");
const INTEREST_WEIGHT = parseFloat(process.env.INTEREST_WEIGHT ?? "0.3");

const findMatch = async (userId, query, socket) => {
  console.log("findMatch started for User ID:", userId);
  let cancelled = false;
  let timeoutHandle = null;

  const cancel = () => {
    cancelled = true;
    if (timeoutHandle) clearTimeout(timeoutHandle);
    matchingBus.off("new_searcher", onNewSearcher);
  };

  // Issue 11: core matching pass — runs immediately and again on every new searcher event
  const checkForMatches = async () => {
    if (matchList.has(userId) || cancelled) return;
    try {
      // Exclude already-friends from the candidate pool (Issue 13)
      const currentUser = await UserDetail.findById(userId).select("friends interests").lean();
      const friendIds = currentUser?.friends?.map((id) => id.toString()) ?? [];

      const allOtherQueries = await UserSearch.find({
        isLocked: false,
        userId: { $ne: userId, $nin: friendIds },
      })
        .sort({ created_at: 1 }) // Oldest waiting first — fair ordering for tied scores (Issue 15)
        .lean();

      console.log(`[${userId}] Found ${allOtherQueries.length} candidate(s)`);
      if (allOtherQueries.length === 0) return;

      // Fetch the searching user's interests once for this pass (Issue 14)
      const selfInterests = currentUser?.interests ?? [];

      // Issue 10: score all candidates in parallel rather than sequentially
      const scoredCandidates = await Promise.all(
        allOtherQueries
          .filter((q) => !matchList.has(q.userId.toString()))
          .map(async (q) => {
            const otherUserId = q.userId.toString();
            try {
              // Fetch candidate profile for interest data
              const candidateProfile = await UserDetail.findById(otherUserId)
                .select("interests")
                .lean();

              const [similarityResult] = await Promise.all([
                withTimeout(runSimilarityService(q.query, query), PYTHON_TIMEOUT_MS),
              ]);

              const querySimilarity = similarityResult.similarity_score;
              const candidateInterests = candidateProfile?.interests ?? [];

              let blendedScore;
              let interestOverlap = 0;

              if (selfInterests.length === 0 || candidateInterests.length === 0) {
                // If either user has no interests registered, default to 100% query similarity
                blendedScore = querySimilarity;
                interestOverlap = 0;
              } else {
                interestOverlap = computeInterestOverlap(selfInterests, candidateInterests);
                blendedScore = QUERY_WEIGHT * querySimilarity + INTEREST_WEIGHT * interestOverlap;
              }

              console.log(
                `[${userId}] vs [${otherUserId}]: query=${querySimilarity.toFixed(3)}, ` +
                `interests=${interestOverlap.toFixed(3)} (fallback=${(selfInterests.length === 0 || candidateInterests.length === 0)}), blended=${blendedScore.toFixed(3)}`
              );

              return { userId: otherUserId, score: blendedScore };
            } catch (err) {
              console.error(`Similarity check failed for candidate ${otherUserId}:`, err.message);
              return null;
            }
          })
      );

      // Filter nulls and below-threshold, then pick the highest scorer
      const validCandidates = scoredCandidates
        .filter((r) => r !== null && r.score >= SIMILARITY_THRESHOLD)
        .sort((a, b) => b.score - a.score);

      if (validCandidates.length === 0) {
        console.log(`[${userId}] No candidates above threshold ${SIMILARITY_THRESHOLD}`);
        return;
      }

      // Walk the ranked list until we can lock both atomically in a deterministic order (Issue 2)
      let bestMatch = null;
      let highestSimilarity = 0;

      for (const candidate of validCandidates) {
        const candidateId = candidate.userId.toString();
        if (matchList.has(candidateId)) continue;

        // Deterministic locking order to prevent concurrent duplicate matching
        const firstId = candidateId < userId ? candidateId : userId;
        const secondId = candidateId < userId ? userId : candidateId;

        const lockedFirst = await lockUser(firstId);
        if (!lockedFirst) {
          console.log(`[${userId}] Failed to lock first ID ${firstId} — skipping candidate ${candidateId}`);
          continue;
        }

        const lockedSecond = await lockUser(secondId);
        if (!lockedSecond) {
          console.log(`[${userId}] Failed to lock second ID ${secondId} — releasing first ID ${firstId} and skipping candidate ${candidateId}`);
          await unlockUser(firstId);
          continue;
        }

        // Successfully locked both!
        bestMatch = candidateId;
        highestSimilarity = candidate.score;
        break; // stop at the first candidate pair we can successfully lock
      }

      if (!bestMatch || matchList.has(userId) || cancelled) {
        if (bestMatch) {
          await Promise.all([unlockUser(bestMatch), unlockUser(userId)]);
        }
        return;
      }

      const matchedSocket = ongoingSearches.get(bestMatch)?.socket;
      const selfSocket = ongoingSearches.get(userId)?.socket;

      // Fetch both profiles in parallel
      const [selfUserProfile, matchedUserProfile] = await Promise.all([
        UserDetail.findOne({ _id: userId }),
        UserDetail.findOne({ _id: bestMatch }),
      ]);

      // Issue 1: corrected emit targets — each party receives the other's profile
      if (matchedSocket) {
        matchedSocket.emit("search_update", {
          matches: { user: selfUserProfile, similarity: highestSimilarity },
          message: "Search result found",
        });
      }
      if (selfSocket) {
        selfSocket.emit("search_update", {
          matches: { user: matchedUserProfile, similarity: highestSimilarity },
          message: "Search result found",
        });
      }

      matchList.set(userId, { match: bestMatch });
      matchList.set(bestMatch, { match: userId });

      await Promise.all([
        UserSearch.deleteOne({ userId }),
        UserSearch.deleteOne({ userId: bestMatch }),
      ]);

      cancel(); // remove event listener and clear timeout
      ongoingSearches.delete(userId);
      ongoingSearches.delete(bestMatch);

      if (!matchedSocket) {
        matchList.delete(userId);
        matchList.delete(bestMatch);
        socket.emit("search_update", {
          matches: null,
          message: "Match found but partner disconnected. Please search again.",
        });
        return;
      }

      console.log(`Match found: users ${userId} and ${bestMatch} paired successfully`);
    } catch (err) {
      console.error("Error during match checking:", err);
      socket.emit("error", { message: "An error occurred while checking for matches." });
      await Promise.all([
        unlockUser(userId),
        bestMatch ? unlockUser(bestMatch) : Promise.resolve(),
      ]);
      ongoingSearches.delete(userId);
      cancel();
    }
  };

  // Issue 11: re-run on every new searcher event instead of polling on a fixed interval
  const onNewSearcher = () => {
    if (!cancelled && !matchList.has(userId)) checkForMatches();
  };
  matchingBus.on("new_searcher", onNewSearcher);

  // Run an immediate first pass in case matching candidates already exist
  checkForMatches();

  // Absolute 30-second deadline — emit timeout and clean up if still unmatched
  timeoutHandle = setTimeout(async () => {
    if (cancelled || matchList.has(userId)) return;
    cancel();
    socket.emit("search_update", { matches: null, message: "No result found" });
    await UserSearch.deleteOne({ userId });
    ongoingSearches.delete(userId);
    console.log(`[${userId}] Search timed out after ${searchTimeoutDuration}ms`);
  }, searchTimeoutDuration);

  return cancel;
};
app.post("/create-chat", async (req, res) => {
  try {
    const { user1Id, user2Id } = req.body;
    // Validate request
    if (!user1Id || !user2Id) {
      return res.status(400).send("User IDs are required");
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
app.get("/chat/:user1Id/:user2Id", async (req, res) => {
  try {
    const { user1Id, user2Id } = req.params;

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
});

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
app.get("/unread-messages/:userId", async (req, res) => {
  const { userId } = req.params;
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
});

// Initialize upload variable
const upload = multer({
  // Set storage engine using Multer
  storage: multer.diskStorage({
    destination: "./public/uploads/",
    filename: function (req, file, cb) {
      cb(
        null,
        file.fieldname + "-" + Date.now() + path.extname(file.originalname)
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
  // Allowed ext
  const filetypes = /jpeg|jpg|png|gif/;
  // Check ext
  const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
  // Check mime
  const mimetype = filetypes.test(file.mimetype);

  if (mimetype && extname) {
    return cb(null, true);
  } else {
    cb("Error: Images Only!");
  }
}
// Route to add items to an existing list in a document
app.post("/add-items/:categoryId", upload, async (req, res) => {
  console.log(req.body, "body");
  const { categoryId } = req.params;
  const files = req.files;
  const items = req.body.items;

  if (!items) {
    return res.status(400).send({ message: "No items provided." });
  }

  try {
    const itemData = JSON.parse(items).map((item, index) => ({
      text: item.text,
      imgUrl: files[index] ? `/uploads/${files[index].filename}` : null,
    }));

    const updatedExplore = await Explore.findByIdAndUpdate(
      categoryId,
      { $push: { list: { $each: itemData } } },
      { new: true, safe: true, upsert: true }
    );

    res.status(200).json(updatedExplore);
  } catch (error) {
    console.error("Error adding items:", error);
    res.status(500).send({ message: "Failed to add items", error: error });
  }
});
// POST route to create a new category
app.post("/add-explore-category", (req, res) => {
  const { category } = req.body;

  if (!category) {
    return res.status(400).json({ message: "Category is required." });
  }

  const newExplore = new Explore({
    category,
    list: [], // Initialize with an empty list or omit if your schema allows
  });

  newExplore
    .save()
    .then((explore) => res.status(201).json(explore))
    .catch((err) =>
      res.status(500).json({ message: "Error saving the category", error: err })
    );
});
//Get all interests
app.get("/explore", async (req, res) => {
  try {
    const explore = await Explore.find();
    res.status(200).json(explore);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

//=========== All socket operations
io.on("connection", (socket) => {
  console.log("New WebSocket connection", socket.id);
  socket.on("submit_keyword", async ({ userId, query }) => {
    // Issue 7: trim and validate the query before doing anything
    const trimmedQuery = (query ?? "").trim();
    if (!userId || !trimmedQuery) {
      socket.emit("error", { message: "UserId and a non-empty query are required." });
      return;
    }
    if (trimmedQuery.length < 3) {
      socket.emit("error", { message: "Search query must be at least 3 characters." });
      return;
    }

    // Issue 8: bind userId to this socket so cancel_search can validate the caller
    socket.data.userId = userId;

    // Issue 6: if the user was previously matched, clean up both sides before re-searching
    if (matchList.has(userId)) {
      const oldPartnerId = matchList.get(userId)?.match;
      matchList.delete(userId);
      if (oldPartnerId) {
        matchList.delete(oldPartnerId);
        ongoingSearches.get(oldPartnerId)?.socket.emit("search_update", {
          matches: null,
          message: "Your match has started a new search.",
        });
      }
    }

    try {
      await UserSearch.findOneAndUpdate(
        { userId },
        { query: trimmedQuery, created_at: new Date(), isLocked: false },
        { upsert: true }
      );

      const cancel = await findMatch(userId, trimmedQuery, socket);
      ongoingSearches.set(userId, { socket, cancel });

      // Issue 11: notify all waiting workers that a new candidate has entered the pool
      matchingBus.emit("new_searcher", { userId, query: trimmedQuery });
    } catch (error) {
      console.error("Error during search submission:", error);
      socket.emit("error", { message: "An error occurred during the search." });
    }
  });
  socket.on("cancel_search", async () => {
    // Issue 8: read userId from the socket itself rather than trusting client-supplied data
    const userId = socket.data.userId;
    if (!userId) return;

    ongoingSearches.get(userId)?.cancel();
    await Promise.all([
      UserSearch.deleteOne({ userId }),
      unlockUser(userId),
    ]);
    ongoingSearches.delete(userId);

    if (matchList.has(userId)) {
      const partnerId = matchList.get(userId)?.match;
      matchList.delete(userId);
      if (partnerId) {
        matchList.delete(partnerId);
        await unlockUser(partnerId);
        ongoingSearches.get(partnerId)?.socket.emit("search_update", {
          matches: null,
          message: "Your match cancelled their search.",
        });
      }
    }
  });
  socket.on("joinChat", ({ chatId }) => {
    socket.join(chatId);
  });
  socket.on("leaveChat", ({ chatId }) => {
    socket.leave(chatId);
  });
  // When a message is sent
  socket.on("sendMessage", async ({ chatId, message }) => {
    if (!chatId && !message) return;
    const newMessage = {
      sender: message.sender,
      content: message.content,
      readBy: [message.sender],
    };

    const updatedChat = await saveMessage(chatId, newMessage);

    io.to(chatId).emit(
      "receiveMessage",
      updatedChat.messages[updatedChat.messages.length - 1]
    );
    // Emit event to update unread counts
    io.emit("updateUnreadCounts");
  });
  // When marking messages as read
  socket.on("markAsRead", async ({ chatId, userId }) => {
    try {
      await Chat.updateMany(
        { _id: chatId },
        { $addToSet: { "messages.$[].readBy": userId } }
      );
    } catch (error) {
      console.error(error);
    }
    // Emit event to update unread counts after marking as read
    io.emit("updateUnreadCounts");
  });
  // Clear all messages by chatId
  socket.on("clearMessages", async ({ chatId }) => {
    try {
      await Chat.updateOne(
        { _id: chatId }, // Match the chat by chatId
        { $set: { messages: [] } } // Set the messages array to an empty array
      );
    } catch (error) {
      console.error(error);
    }

    // Optionally, emit an event to notify the client that the messages have been cleared
    io.emit("messagesCleared");
  });
  socket.on("disconnect", async () => {
    console.log("Socket disconnected:", socket.id);

    // Issue 3: clean up all search state associated with this specific socket
    for (const [uid, entry] of ongoingSearches.entries()) {
      if (entry.socket.id === socket.id) {
        entry.cancel();
        await UserSearch.deleteOne({ userId: uid });
        ongoingSearches.delete(uid);

        // If this user was already matched, release the partner from that pairing
        if (matchList.has(uid)) {
          const partnerId = matchList.get(uid)?.match;
          matchList.delete(uid);
          if (partnerId) {
            matchList.delete(partnerId);
            await unlockUser(partnerId);
            ongoingSearches.get(partnerId)?.socket.emit("search_update", {
              matches: null,
              message: "Your match disconnected. Please search again.",
            });
          }
        }
        break;
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

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

//===============
// const DAILY_API_KEY =
//   "3c8cb975ccb3db342cdec030f501796ba80f1e7c49e65c5f983bc5103abcaa6e";

// app.post("/start-call", async (req, res) => {
//   const { userId1, userId2, socket } = req.body;
//   console.log(userId1, userId2, socket, "123");
//   return;
//   try {
//     const roomResponse = await axios.post(
//       "https://api.daily.co/v1/rooms",
//       { properties: { exp: Math.round(Date.now() / 1000) + 3600 } }, // Room expires in 1 hour
//       {
//         headers: {
//           Authorization: `Bearer ${DAILY_API_KEY}`,
//           "Content-Type": "application/json",
//         },
//       }
//     );

//     const roomUrl = roomResponse.data.url;

//     // Notify both users with the room URL (using your socket implementation)
//     socket.to(userId1).emit("call-invite", { roomUrl, matchedUser: userId2 });
//     socket.to(userId2).emit("call-invite", { roomUrl, matchedUser: userId1 });

//     res.json({ success: true, roomUrl });
//   } catch (error) {
//     console.error("Error creating room:", error);
//     res.status(500).json({ success: false, message: "Failed to create room" });
//   }
// });
