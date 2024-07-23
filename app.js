import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import UserDetailSchema from "./models/UserDetailSchema.js";
import InterestSchema from "./models/InterestSchema.js";
import admin from "./firebaseAdmin.js";

const app = express();
const port = 5051;

app.use(express.json());
app.use(cors());

const uri = `mongodb+srv://subhomkundu:5uOIiGCbYu6xUg1b@cluster0.k8g0qnb.mongodb.net/clickmate?retryWrites=true&w=majority&appName=Cluster0`;

mongoose
  .connect(uri)
  .then(() => console.log("Connected to MongoDB"))
  .catch((err) => console.error("Error connecting to MongoDB:", err));

//To fetch all the users
app.get("/users", async (req, res) => {
  try {
    const users = await UserDetailSchema.find();
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});
// To register a user
const User = mongoose.model("user");
app.post("/register", async (req, res) => {
  const { name, email } = req.body;

  const oldUser = await User.findOne({ email });
  if (oldUser) return res.status(409).send({ data: "User already exists!" });
  try {
    await User.create({
      fullname: name,
      email,
      created_at: Date(),
      updated_at: Date(),
    });
    res
      .status(201)
      .send({ status: "ok", statusCode: 200, data: "User is created" });
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
    const updatedUser = await User.findByIdAndUpdate(
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
app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
});
// Fetch user's details by useremail
app.get("/user/:email", async (req, res) => {
  const { email } = req.params;
  try {
    const user = await User.findOne({ email });
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
    const result = await User.deleteOne({ _id: uid });
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
