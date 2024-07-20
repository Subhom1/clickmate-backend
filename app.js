import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import UserDetailSchema from "./models/UserDetailSchema.js"; // Adjust the path as necessary

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
      updated_at: Date()
    });
    res.status(201).send({ status: "ok", statusCode: 200, data: "User is created" });
  } catch (err) {
    res.status(500).send({ status: "error", data: err.res });
  }
});
app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
});
