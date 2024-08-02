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
const searchTimeoutDuration = 30000; // 20 seconds
const checkInterval = 1000; // 1 second

const runPythonScript = (text1, text2) => {
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

const findMatches = async (userId, query, socket) => {
  let cancelled = false; // Flag to track if the search has been cancelled

  // Function to cancel the search
  const cancel = () => {
    cancelled = true;
  };

  let attempts = 0; // Initialize the attempts counter
  const maxAttempts = searchTimeoutDuration / checkInterval; // Calculate the maximum number of attempts based on the total search timeout duration and the interval between attempts

  // Function to lock a user for searching to prevent concurrent operations on the same user
  const lockUser = async (userId) => {
    const user = await UserSearch.findOneAndUpdate(
      { userId, isLocked: { $ne: true } }, // Find the user who is not already locked
      { isLocked: true }, // Set the user's isLocked field to true
      { new: true } // Return the updated document
    );
    return user != null; // Return true if the user was successfully locked, false otherwise
  };

  // Function to unlock a user after searching
  const unlockUser = async (userId) => {
    await UserSearch.findOneAndUpdate({ userId }, { isLocked: false });
  };

  // Function to check for potential matches for the given user
  const checkForMatches = async () => {
    if (cancelled) return; // Exit if the search has been cancelled

    attempts++; // Increment the attempts counter

    try {
      const lockAcquired = await lockUser(userId); // Attempt to lock the user
      if (!lockAcquired) {
        // If the lock was not acquired
        if (attempts < maxAttempts) {
          // If the maximum number of attempts has not been reached
          setTimeout(checkForMatches, checkInterval); // Retry after a specified interval
        } else {
          console.log(ongoingSearches, "ongoing users 1");
          // If the maximum number of attempts has been reached
          ongoingSearches?.get(userId)?.socket.emit("search_update", {
            matches: [],
            message: "No matching results found",
          });
          await UserSearch.deleteOne({ userId }); // Delete the user's search record from the database
          ongoingSearches.delete(userId); // Remove the user's search from the ongoing searches map
        }
        return;
      }

      // Check if the user is already in a match
      const existingMatch = await MatchList.findOne({
        $or: [{ user1: userId }, { user2: userId }],
      });

      if (existingMatch) {
        // If a match already exists for the user
        await unlockUser(userId); // Unlock the user
        ongoingSearches.delete(userId); // Remove the user's search from the ongoing searches map
        return;
      }

      // Find all matched user IDs
      const matchedUserIds = await MatchList.find({}).distinct("user2");
      // Find all searches that are not locked and exclude the matched users and the current user
      const searches = await UserSearch.find({
        userId: { $ne: userId, $nin: matchedUserIds },
        isLocked: { $ne: true },
      });

      for (const search of searches) {
        if (cancelled) break; // Exit if the search has been cancelled

        const lockAcquiredForSearch = await lockUser(search.userId.toString()); // Attempt to lock the potential match user
        if (!lockAcquiredForSearch) continue; // If the lock was not acquired, continue to the next potential match

        const similarityResult = await runPythonScript(query, search.query); // Calculate the similarity between the current user's query and the potential match's query
        const similarity = similarityResult.similarity_score; // Extract the similarity score

        if (similarity >= 0.4) {
          // If a match is found based on the similarity threshold
          const user2 = search.userId.toString(); // Get the ID of the matched user

          // Check if the potential match user is already in a match
          const alreadyMatched = await MatchList.findOne({
            $or: [{ user1: user2 }, { user2: user2 }],
          });

          if (alreadyMatched) {
            // If the potential match user is already in a match
            await unlockUser(user2); // Unlock the potential match user
            continue; // Continue to the next potential match
          }

          // Create a new match record
          await MatchList.create({ user1: userId, user2, similarity });

          // Delete the search records for both users
          await UserSearch.deleteOne({ userId: user2 });
          await UserSearch.deleteOne({ userId });

          const matchedUser = await UserDetail.findOne({ _id: user2 }); // Retrieve the matched user's details
          socket.emit("search_update", {
            matches: [{ user: matchedUser, similarity }],
          });

          // Notify the matched user if they have an active WebSocket connection
          const matchedUserSocket = ongoingSearches.get(user2)?.socket;
          if (matchedUserSocket) {
            matchedUserSocket.emit("search_update", {
              matches: [
                { user: await UserDetail.findOne({ _id: userId }), similarity },
              ],
            });
            ongoingSearches.delete(user2); // Remove the matched user's search from the ongoing searches map
          }

          // Unlock both users and clean up the ongoing searches
          await unlockUser(userId);
          await unlockUser(user2);
          ongoingSearches.delete(userId);
          return;
        } else {
          await unlockUser(search.userId.toString()); // Unlock the potential match user if no match is found
        }
      }

      await unlockUser(userId); // Unlock the current user if no match is found

      if (attempts < maxAttempts) {
        // If the maximum number of attempts has not been reached
        setTimeout(checkForMatches, checkInterval); // Retry after a specified interval
      } else {
        // If the maximum number of attempts has been reached
        console.log(ongoingSearches, "ongoing users");
        socket.emit("search_update", {
          matches: [],
          message: "No matching results found",
        });
        await UserSearch.deleteOne({ userId }); // Delete the user's search record from the database
        ongoingSearches.delete(userId); // Remove the user's search from the ongoing searches map
      }
    } catch (error) {
      if (cancelled) return; // Exit if the search has been cancelled
      console.error("Error during match checking:", error); // Log the error
      socket.emit("error", {
        message: "An error occurred while checking for matches.",
      });
      await unlockUser(userId); // Ensure the user is unlocked
      ongoingSearches.delete(userId); // Remove the user's search from the ongoing searches map
    }
  };

  checkForMatches(); // Start the match checking process

  return cancel; // Return the cancel function to allow the search to be cancelled
};

// WebSocket connection event handler
io.on("connection", (socket) => {
  console.log("New WebSocket connection"); // Log the new connection

  // mongoose.connection.db.dropCollection("search"); // Drop the 'search' collection
  mongoose.connection.db.dropCollection("match_list"); // Drop the 'match_list' collection

  // Event handler for keyword submission
  socket.on("submit_keyword", async (data) => {
    const { userId, query } = data; // Extract userId and query from the submitted data

    if (!userId || !query) {
      // If either userId or query is missing
      socket.emit("error", { message: "UserId and query are required." }); // Send an error message to the client
      return;
    }

    try {
      // Update the user's search record in the database, or create a new one if it doesn't exist
      await UserSearch.findOneAndUpdate(
        { userId },
        { query, created_at: new Date(), isLocked: false },
        { upsert: true }
      );

      if (ongoingSearches.has(userId)) {
        // If there is an ongoing search for the user
        ongoingSearches.get(userId).cancel(); // Cancel the ongoing search
        ongoingSearches.delete(userId); // Remove the user's search from the ongoing searches map
      }

      // Start a new search for the user
      const cancelSearch = findMatches(userId, query, socket);
      ongoingSearches.set(userId, { socket, cancel: cancelSearch });

      // Re-check matches for all ongoing searches when a new user submits
      ongoingSearches.forEach(
        async ({ socket: ongoingSocket, cancel }, ongoingUserId) => {
          if (ongoingUserId !== userId) {
            if (typeof cancel === "function") {
              cancel(); // Cancel the ongoing search
            }
            const otherQuery = (
              await UserSearch.findOne({ userId: ongoingUserId })
            ).query; // Get the query of the other ongoing user
            findMatches(ongoingUserId, otherQuery, ongoingSocket); // Start a new search for the other user
          }
        }
      );
    } catch (error) {
      console.error("Error during search submission:", error); // Log the error
      socket.emit("error", { message: "An error occurred during the search." }); // Send an error message to the client
    }
  });

  // Event handler for search cancellation
  socket.on("cancel_search", async (userId) => {
    if (ongoingSearches.has(userId)) {
      // If there is an ongoing search for the user
      ongoingSearches.get(userId).cancel(); // Cancel the ongoing search
      ongoingSearches.delete(userId); // Remove the user's search from the ongoing searches map
      await UserSearch.deleteOne({ userId }); // Delete the user's search record from the database
      console.log(`Search cancelled for user: ${userId}`); // Log```javascript
      console.log(`Search cancelled for user: ${userId}`); // Log the cancellation
    }
  });

  // Event handler for WebSocket disconnection
  socket.on("disconnect", () => {
    ongoingSearches.forEach((value, key) => {
      if (value.socket === socket) {
        // If the disconnected socket is associated with an ongoing search
        if (typeof value.cancel === "function") {
          value.cancel(); // Cancel the ongoing search
        }
        ongoingSearches.delete(key); // Remove the search from the ongoing searches map
        console.log(`Connection lost and search cancelled for user: ${key}`); // Log the disconnection and cancellation
      }
    });
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
