import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import UserDetail from "./models/UserDetailSchema.js";
import UserSearch from "./models/UserSearchSchema.js";
import { spawn } from "child_process";
import { Server as socketIo } from "socket.io";
import http from "http";
import axios from "axios";
import Chat from "./models/ChatScema.js";
import Interest from "./models/InterestSchema.js";

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 5051;

// Middleware
app.use(express.json());
app.use(cors());

// Create HTTP server
const server = http.createServer(app);

// Attach WebSocket server to the HTTP server
const io = new socketIo(server);

const uri = `mongodb+srv://subhomkundu:5uOIiGCbYu6xUg1b@cluster0.k8g0qnb.mongodb.net/clickmate?retryWrites=true&w=majority&appName=Cluster0`;

mongoose
  .connect(uri)
  .then(() => console.log("Connected to MongoDB"))
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

// User Operations
// Fetch user's details by email
app.get("/user/:email", async (req, res) => {
  const { email } = req.params;
  try {
    const user = await UserDetail.findOne({ email }).populate("interests");

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
    if (req.body.bio) {
      updateFields.bio = req.body.bio;
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
    );

    if (!updatedUser) {
      return res.status(404).json({ message: "User not found" });
    }

    res.status(200).json(updatedUser);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

//Delete user
app.delete("/deleteUser/:uid/:fuid", async (req, res) => {
  const { uid, fuid } = req.params;

  try {
    // Delete user from MongoDB using Mongoose
    const result = await UserDetail.deleteOne({ _id: uid });
    // await admin.auth().deleteUser(fuid);

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
const ongoingSearches = new Map();
const matchList = new Map();

const searchTimeoutDuration = 10000; // 10 seconds
const checkInterval = 1000; // 1 second

const runPythonScript = async (text1, text2) => {
  return new Promise((resolve, reject) => {
    const process = spawn("python3", [
      "scripts/calculate_similarity.py",
      text1,
      text2,
    ]);

    let result = "";
    let error = "";

    process.stdout.on("data", (data) => {
      result += data.toString();
    });

    process.stderr.on("data", (data) => {
      error += data.toString();
    });

    process.on("close", (code) => {
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

const findMatch = async (userId, query, socket) => {
  console.log("findMatch function called for User ID:", userId);
  let cancelled = false;

  const cancel = () => {
    cancelled = true;
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
      }).lean(); // Used lean() to improve performance by returning plain JavaScript objects

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

        try {
          const result = await runPythonScript(q.query, query);
          const similarity = result.similarity_score;

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
        highestSimilarity >= 0.5 &&
        !matchList.has(bestMatch) &&
        !matchList.has(userId) &&
        !cancelled
      ) {
        await lockUser(userId);
        await lockUser(bestMatch);
        const matchedSocket = ongoingSearches.get(bestMatch)?.socket;
        const selfSocket = ongoingSearches.get(userId)?.socket;
        if (matchedSocket && selfSocket) {
          matchedSocket.emit("search_update", {
            matches: {
              user: await UserDetail.findOne({ _id: userId }),
              similarity: highestSimilarity,
            },

            message: "Search result found",
          });
          // selfSocket.emit("search_update", {
          //   matches: {
          //     user: await UserDetail.findOne({ _id: bestMatch }),
          //     similarity: highestSimilarity,
          //   },

          //   message: "Search result found",
          // });
        }
        matchList.set(userId, { match: bestMatch });
        matchList.set(bestMatch, { match: userId });
        await UserSearch.deleteOne({ userId });
        await UserSearch.deleteOne({ userId: bestMatch });
        ongoingSearches.delete(userId);
        ongoingSearches.delete(bestMatch);
        if (!matchedSocket && selfSocket && matchList.has(userId)) {
          matchList.delete(userId);
          socket.emit("search_update", {
            matches: null,
            message: "No result found",
          });
          return;
        }
        console.log(
          `Match found and users ${userId} and ${bestMatch} removed from search`
        );
        return;
      }

      if (attempts < maxAttempts && !cancelled) {
        setTimeout(checkForMatches, checkInterval);
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

  checkForMatches();
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
    const chat = await Chat.findById(chatId);
    chat.messages.push(message);
    await chat.save();
    return chat;
  } catch (error) {
    console.error(error.message);
    throw new Error("Error saving message");
  }
};
io.on("connection", (socket) => {
  console.log("New WebSocket connection", socket.id);
  socket.on("submit_keyword", async ({ userId, query }) => {
    if (!userId || !query) {
      socket.emit("error", { message: "UserId and query are required." });
      return;
    } else if (matchList.has(userId)) {
      matchList.delete(userId);
    }

    try {
      await UserSearch.findOneAndUpdate(
        { userId },
        { query, created_at: new Date(), isLocked: false },
        { upsert: true }
      );

      const cancel = await findMatch(userId, query, socket);
      ongoingSearches.set(userId, { socket, cancel });
    } catch (error) {
      console.error("Error during search submission:", error);
      socket.emit("error", { message: "An error occurred during the search." });
    }
  });
  socket.on("cancel_search", async (data) => {
    const { userId } = data;
    ongoingSearches.get(userId)?.cancel();
    await UserSearch.deleteOne({ userId });
    await unlockUser(userId);
    ongoingSearches.delete(userId);
    if (matchList.has(userId)) {
      //TODO: need rework
      const partnerId = matchList.get(userId)?.match;
      matchList.delete(userId);
      matchList.delete(partnerId);
      await unlockUser(partnerId);
      ongoingSearches.get(partnerId)?.socket.emit("search_update", {
        matches: null,
        message: "No partner found",
      });
    }
  });
  socket.on("joinChat", ({ chatId }) => {
    console.log(chatId, "joined Chat");
    socket.join(chatId);
  });
  socket.on("leaveChat", ({ chatId }) => {
    console.log(chatId, "left Chat");
    socket.leave(chatId);
  });
  socket.on("sendMessage", async ({ chatId, message }) => {
    if (!chatId && !message) return;
    const newMessage = {
      sender: message.sender,
      content: message.content,
    };

    const updatedChat = await saveMessage(chatId, newMessage);

    io.to(chatId).emit(
      "receiveMessage",
      updatedChat.messages[updatedChat.messages.length - 1]
    );
  });
  socket.on("disconnect", () => {
    console.log("Socket disconnected");
  });
});

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

// Endpoint to add interests //ONLY AS A ADMIN IF I WANT TO ADD ANY NEW INTEREST TO THE DB
app.post("/add-interest", async (req, res) => {
  const { interest } = req.body; // Extract the interest array from the request body

  if (!Array.isArray(interest) || interest.length === 0) {
    return res
      .status(400)
      .json({ message: "Interest array is required and must be non-empty" });
  }

  // Ensure all items in the array have the required 'text' field
  const missingTextFields = interest.filter((item) => !item.text);
  if (missingTextFields.length > 0) {
    return res
      .status(400)
      .json({ message: "Each interest object must contain a 'text' field" });
  }

  // Extract the texts for easy processing
  const interestTexts = interest.map((item) => item.text);

  try {
    // Find existing interests
    const existingInterests = await Interest.find({
      text: { $in: interestTexts },
    }).lean();
    const existingTexts = new Set(existingInterests.map((item) => item.text));

    // Determine new interests to insert
    const newInterests = interest.filter(
      (item) => !existingTexts.has(item.text)
    );

    // Insert new interests
    if (newInterests.length > 0) {
      const result = await Interest.insertMany(newInterests, {
        ordered: false,
      });
      res.status(201).json({
        message: `${result.length} new interests added`,
        added: result,
      });
    } else {
      res.status(200).json({ message: "No new interests to add" });
    }
  } catch (error) {
    // Log the full error for debugging
    console.error("Error inserting interests:", error);

    // Handle errors, such as validation errors
    if (error.code === 11000) {
      // Duplicate key error code
      res.status(409).json({ message: "One or more interests already exist" });
    } else {
      res.status(500).json({ message: error.message });
    }
  }
});
