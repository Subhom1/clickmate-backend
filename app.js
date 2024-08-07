import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import UserDetail from "./models/UserDetailSchema.js";
import UserSearch from "./models/UserSearchSchema.js";
import Interest from "./models/InterestSchema.js";
import admin from "./firebaseAdmin.js";
import cron from "node-cron";
import { exec, spawn } from "child_process";
import { Server as socketIo } from "socket.io";
import http from "http";
import MatchList from "./models/MatchListSchema.js";
// import { findMatches, ongoingSearches } from "./findMatch.js";
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

//To fetch all the users
app.get("/users", async (req, res) => {
  try {
    const users = await UserDetail.find();
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});
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
// Endpoint to add interests to an existing user
app.post("/user/:id/interests", async (req, res) => {
  const { id } = req.params;
  const { interest } = req.body; // Expecting an array of objects with id "interest": [{ "id": "669d98bae0b0218423887373" }]
  // Validate request
  if (
    !Array.isArray(interest) ||
    interest.length === 0 ||
    !interest.every((i) => i.id)
  ) {
    return res
      .status(400)
      .send({ status: "error", message: "Invalid interest format" });
  }
  try {
    // Extract the IDs from the request payload
    const interestIds = interest.map((item) => item.id);

    // Update user with new interests
    const updatedUser = await UserDetail.findByIdAndUpdate(
      id,
      { $addToSet: { interest: { $each: interestIds } } },
      { new: true }
    );

    if (!updatedUser) {
      return res
        .status(404)
        .send({ status: "error", message: "User not found" });
    }

    res.status(200).send({ status: "ok", data: updatedUser });
  } catch (err) {
    console.error("Internal server error:", err);
    res.status(500).send({ status: "error", message: err.message });
  }
});

// Fetch user's details by useremail
app.get("/user/:email", async (req, res) => {
  const { email } = req.params;
  try {
    const user = await UserDetail.findOne({ email });
    if (!user) {
      return res
        .status(404)
        .send({ status: "error", message: "User not found" });
    }
    res.status(200).send({ status: "ok", data: user });
  } catch (err) {
    res.status(500).send({ status: "error", data: err.message });
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
const ongoingSearches = new Map();
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

const matchList = new Map();
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
          selfSocket.emit("search_update", {
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

io.on("connection", (socket) => {
  console.log("New WebSocket connection");

  socket.on("submit_keyword", async ({ userId, query }) => {
    if (!userId || !query) {
      socket.emit("error", { message: "UserId and query are required." });
      return;
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
    ongoingSearches.get(userId).cancel();
    await UserSearch.deleteOne({ userId });
    await unlockUser(userId);
    ongoingSearches.delete(userId);
    if (matchList.has(userId)) {
      //TODO: need rework
      const partnerId = matchList.get(userId)?.match;
      matchList.delete(userId);
      matchList.delete(partnerId);
      await unlockUser(partnerId);
      ongoingSearches.get(partnerId).socket.emit("search_update", {
        matches: null,
        message: "No partner found",
      });
    }
  });

  socket.on("disconnect", () => {
    console.log("Socket disconnected");
  });
});

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
// const Interest = mongoose.model("interest");
// Endpoint to add interests //ONLY AS A ADMIN IF I WANT TO ADD ANY NEW INTEREST TO THE DB
// app.post("/interests", async (req, res) => {
//   console.log(req.body);
//   const { interest } = req.body;
//   try {
//     const existingInterestDoc = await Interest.findOne();
//     if (!existingInterestDoc) {
//       await Interest.create({ interest });
//       return res
//         .status(201)
//         .send({ status: "ok", data: "Interests added successfully" });
//     }
//     const updatedInterests = Array.from(
//       new Set([...existingInterestDoc.interest, ...interest])
//     );
//     existingInterestDoc.interest = updatedInterests;
//     await existingInterestDoc.save();
//     res
//       .status(201)
//       .send({ status: "ok", data: "Interests updated successfully" });
//   } catch (err) {
//     res.status(500).send({ status: "error", data: err.message });
//   }
// });
