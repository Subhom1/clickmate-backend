import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import UserDetailSchema from "./models/UserDetailSchema.js";
import InterestSchema from "./models/InterestSchema.js";

const app = express();
const port = 5051;

app.use(express.json());
app.use(cors());

const uri = `mongodb+srv://subhomkundu:5uOIiGCbYu6xUg1b@cluster0.k8g0qnb.mongodb.net/clickmate?retryWrites=true&w=majority&appName=Cluster0`;

mongoose
  .connect(uri)
  .then(() => console.log("Connected to MongoDB"))
  .catch((err) => console.error("Error connecting to MongoDB:", err));

app.get("/users", async (req, res) => {
  try {
    const users = await UserDetailSchema.find();
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});
const User = mongoose.model("user");
app.post("/register", async (req, res) => {
  const { name, email } = req.body;

  const oldUser = await User.findOne({ email });
  if (oldUser) return res.status(409).send({ data: "User already exists!" });
  try {
    await User.create({
      username: name,
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
const Interest = mongoose.model("interest");
// Endpoint to add interests
app.post("/interests", async (req, res) => {
  console.log(req.body);
  const { interest } = req.body;
  try {
    const existingInterestDoc = await Interest.findOne();
    if (!existingInterestDoc) {
      await Interest.create({ interest });
      return res
        .status(201)
        .send({ status: "ok", data: "Interests added successfully" });
    }
    const updatedInterests = Array.from(
      new Set([...existingInterestDoc.interest, ...interest])
    );
    existingInterestDoc.interest = updatedInterests;
    await existingInterestDoc.save();
    res
      .status(201)
      .send({ status: "ok", data: "Interests updated successfully" });
  } catch (err) {
    res.status(500).send({ status: "error", data: err.message });
  }
});
// Endpoint to add interests to an existing user
app.post("/user/:id/interests", async (req, res) => {
  const { id } = req.params;
  const { interest } = req.body; // Expecting an array of objects with id

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
