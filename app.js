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
const searchTimeoutDuration = 30000; // 30 seconds
const checkInterval = 2000; // 1 second

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

  let attempts = 0;
  const maxAttempts = searchTimeoutDuration / checkInterval;

  const checkForMatches = async () => {
    if (matchList.has(userId)) return;

    attempts++;

    try {
      const allOtherQueries = await UserSearch.find({
        isLocked: false,
        userId: { $ne: userId },
      }).lean(); // Use lean() to improve performance by returning plain JavaScript objects

      console.log(
        `Attempt ${attempts}: Found ${allOtherQueries.length} other queries`
      );

      let bestMatch = null;
      let highestSimilarity = 0;

      // if (existingMatch) {
      //   ongoingSearches.delete(userId);
      //   return;
      // }
      for (let q of allOtherQueries) {
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
      console.log("bestMatch:", bestMatch);
      if (
        bestMatch &&
        highestSimilarity >= 0.5 &&
        !matchList.has(bestMatch) &&
        !matchList.has(userId)
      ) {
        const userLocked = await lockUser(userId);
        const matchLocked = await lockUser(bestMatch);
        // if (matchLocked && userLocked) {
        const matchedSocket = ongoingSearches.get(bestMatch)?.socket;
        if (matchedSocket) {
          matchedSocket.emit("search_update", {
            matches: 
              {
                user: await UserDetail.findOne({ _id: userId }),
                similarity: highestSimilarity,
              },
            
            message: "Search result found",
          });
        }
        const selfSocket = ongoingSearches.get(userId)?.socket;
        if (selfSocket) {
          selfSocket.emit("search_update", {
            matches: 
              {
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
        // } else {
        //   console.log(`Could not lock User ID: ${bestMatch} for final match`);
        // }
      }

      if (attempts < maxAttempts) {
        setTimeout(checkForMatches, checkInterval);
      } else {
        socket.emit("search_update", {
          matches: [],
          message: "No result found",
        });
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
  // const userLocked = await lockUser(userId);
  // if (userLocked) {
  // } else {
  //   socket.emit("error", { message: "Unable to lock user for searching." });
  // }
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

      ongoingSearches.set(userId, { socket });
      await findMatch(userId, query, socket);
    } catch (error) {
      console.error("Error during search submission:", error);
      socket.emit("error", { message: "An error occurred during the search." });
    }
  });

  socket.on("cancel_search", async (data) => {
    const { userId } = data;
    await UserSearch.deleteOne({ userId });
    await unlockUser(userId);
    ongoingSearches.delete(userId);
    socket.emit("search_cancelled", {
      message: "Search cancelled successfully.",
    });
  });

  socket.on("disconnect", () => {
    console.log("Socket disconnected");
  });
});

// const findMatches = async (userId, query, socket) => {
//   let cancelled = false;

//   const cancel = () => {
//     cancelled = true;
//   };

//   let attempts = 0;
//   const maxAttempts = searchTimeoutDuration / checkInterval;

//   const lockUser = async (userId) => {
//     const user = await UserSearch.findOneAndUpdate(
//       { userId, isLocked: { $ne: true } },
//       { isLocked: true },
//       { new: true }
//     );
//     return user != null;
//   };

//   const unlockUser = async (userId) => {
//     await UserSearch.findOneAndUpdate({ userId }, { isLocked: false });
//   };

//   const checkForMatches = async () => {
//     if (cancelled) return;

//     attempts++;

//     try {
//       const lockAcquired = await lockUser(userId);
//       if (!lockAcquired) {
//         if (attempts < maxAttempts) {
//           setTimeout(checkForMatches, checkInterval);
//         } else {
//           !cancelled &&
//             ongoingSearches?.get(userId)?.socket.emit("search_update", {
//               matches: [],
//               message: "No matching results found",
//             });
//           await UserSearch.deleteOne({ userId });
//           ongoingSearches.delete(userId);
//         }
//         return;
//       }

//       const existingMatch = await MatchList.findOne({
//         $or: [{ user1: userId }, { user2: userId }],
//       });

//       if (existingMatch) {
//         await unlockUser(userId);
//         ongoingSearches.delete(userId);
//         return;
//       }

//       const matchedUserIds = await MatchList.find({}).distinct("user2");
//       const searches = await UserSearch.find({
//         userId: { $ne: userId, $nin: matchedUserIds },
//         isLocked: { $ne: true },
//       });

//       for (const search of searches) {
//         if (cancelled) break;

//         const lockAcquiredForSearch = await lockUser(search.userId.toString());
//         if (!lockAcquiredForSearch) continue;

//         const similarityResult = await runPythonScript(query, search.query);
//         const similarity = similarityResult.similarity_score;

//         if (similarity >= 0.4) {
//           const user2 = search.userId.toString();

//           const alreadyMatched = await MatchList.findOne({
//             $or: [{ user1: user2 }, { user2: user2 }],
//           });

//           if (alreadyMatched) {
//             await unlockUser(user2);
//             continue;
//           }

//           await MatchList.create({ user1: userId, user2, similarity });

//           await UserSearch.deleteOne({ userId: user2 });
//           await UserSearch.deleteOne({ userId });

//           const matchedUser = await UserDetail.findOne({ _id: user2 });
//           socket.emit("search_update", {
//             matches: [{ user: matchedUser, similarity }],
//           });

//           const matchedUserSocket = ongoingSearches.get(user2)?.socket;
//           if (matchedUserSocket) {
//             matchedUserSocket.emit("search_update", {
//               matches: [
//                 { user: await UserDetail.findOne({ _id: userId }), similarity },
//               ],
//             });
//             ongoingSearches.delete(user2);
//           }

//           await unlockUser(userId);
//           await unlockUser(user2);
//           ongoingSearches.delete(userId);
//           return;
//         } else {
//           await unlockUser(search.userId.toString());
//         }
//       }

//       await unlockUser(userId);

//       if (attempts < maxAttempts) {
//         setTimeout(checkForMatches, checkInterval);
//       } else {
//         !cancelled &&
//           socket.emit("search_update", {
//             matches: [],
//             message: "No matching results found",
//           });
//         await UserSearch.deleteOne({ userId });
//         ongoingSearches.delete(userId);
//       }
//     } catch (error) {
//       if (cancelled) return;
//       console.error("Error during match checking:", error);
//       socket.emit("error", {
//         message: "An error occurred while checking for matches.",
//       });
//       await unlockUser(userId);
//       ongoingSearches.delete(userId);
//     }
//   };

//   checkForMatches();

//   return cancel;
// };

// io.on("connection", (socket) => {
//   console.log("New WebSocket connection");

//   // Comment out these lines for normal operation
//   mongoose.connection.db.dropCollection("search");
//   mongoose.connection.db.dropCollection("match_list");

//   socket.on("submit_keyword", async (data) => {
//     const { userId, query } = data;

//     if (!userId || !query) {
//       socket.emit("error", { message: "UserId and query are required." });
//       return;
//     }

//     try {
//       await UserSearch.findOneAndUpdate(
//         { userId },
//         { query, created_at: new Date(), isLocked: false },
//         { upsert: true }
//       );

//       if (ongoingSearches.has(userId)) {
//         const searchObj = ongoingSearches.get(userId);
//         if (searchObj && typeof searchObj.cancel === "function") {
//           searchObj.cancel();
//         }
//         ongoingSearches.delete(userId);
//       }

//       const cancelSearch = findMatches(userId, query, socket);
//       ongoingSearches.set(userId, { socket, cancel: cancelSearch });

//       ongoingSearches.forEach(
//         async ({ socket: ongoingSocket, cancel }, ongoingUserId) => {
//           if (ongoingUserId !== userId) {
//             if (typeof cancel === "function") {
//               cancel();
//             }
//             const otherQuery = (
//               await UserSearch.findOne({ userId: ongoingUserId })
//             ).query;
//             findMatches(ongoingUserId, otherQuery, ongoingSocket);
//           }
//         }
//       );
//     } catch (error) {
//       console.error("Error during search submission:", error);
//       socket.emit("error", { message: "An error occurred during the search." });
//     }
//   });

//   socket.on("cancel_search", async (data) => {
//     const { userId } = data;
//     console.log(ongoingSearches, '#searches');
//     if (ongoingSearches.has(userId)) {
//       const searchObj = ongoingSearches.get(userId);
//       if (searchObj && typeof searchObj.cancel === "function") {
//         searchObj.cancel();
//       } else {
//         console.log("Cancel function not found or not a function");
//       }
//       ongoingSearches.delete(userId);
//       await UserSearch.deleteOne({ userId });
//       console.log(`Search cancelled for user: ${userId}`);
//     }
//   });

//   socket.on("disconnect", () => {
//     ongoingSearches.forEach((value, key) => {
//       if (value.socket === socket) {
//         if (typeof value.cancel === "function") {
//           value.cancel();
//         } else {
//           console.log(
//             "Cancel function not found or not a function on disconnect"
//           );
//         }
//         ongoingSearches.delete(key);
//         console.log(`Connection lost and search cancelled for user: ${key}`);
//       }
//     });
//   });
// });

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
