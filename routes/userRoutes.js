import { Router } from "express";
import UserDetail from "../models/UserDetailSchema.js";
import { admin, authenticate, loadAuthenticatedUser, requireOwnUser } from "../middleware/auth.js";
import { isValidObjectId, normalizeEmail } from "../utils/validation.js";

const router = Router();

router.post("/register", authenticate, async (req, res) => {
  const { name, email } = req.body;
  const normalizedEmail = normalizeEmail(req.auth.email);
  const normalizedName = typeof name === "string" ? name.trim() : "";
  if (!normalizedName || !normalizedEmail || (email && normalizeEmail(email) !== normalizedEmail)) {
    return res.status(400).send({ data: "Name and email are required" });
  }
  try {
    if (await UserDetail.findOne({ email: normalizedEmail })) {
      return res.status(409).send({ data: "User already exists!" });
    }
    const newUser = await UserDetail.create({
      fullname: normalizedName.toLowerCase(), email: normalizedEmail,
      firebaseUid: req.auth.uid, created_at: new Date(), updated_at: new Date(),
    });
    res.status(201).send({ status: "ok", statusCode: 201, data: newUser });
  } catch (error) {
    res.status(500).send({ status: "error", data: error.message });
  }
});

router.get("/user/:email", authenticate, async (req, res) => {
  const email = normalizeEmail(req.params.email);
  if (email !== normalizeEmail(req.auth.email)) {
    return res.status(403).json({ message: "You can only access your own user" });
  }
  try {
    const user = await UserDetail.findOne({ email }).populate("interests").populate("friends");
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json(user);
  } catch (error) {
    console.error("Error fetching user:", error);
    res.status(500).json({ message: "Unable to fetch user" });
  }
});

router.get("/users/:userId/friends", authenticate, loadAuthenticatedUser, requireOwnUser, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.userId)) return res.status(400).json({ message: "Invalid user ID" });
    const user = await UserDetail.findById(req.params.userId).populate("friends", "fullname email bio interests");
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json(user.friends);
  } catch (error) {
    console.error("Error fetching friends:", error);
    res.status(500).json({ message: "Unable to fetch friends" });
  }
});

router.patch("/user/:userId", authenticate, loadAuthenticatedUser, requireOwnUser, async (req, res) => {
  try {
    const { userId } = req.params;
    if (!isValidObjectId(userId)) return res.status(400).json({ message: "Invalid user ID" });
    const updateFields = { updated_at: new Date() };
    if (req.body.fullname) updateFields.fullname = req.body.fullname;
    if (req.body.bio !== undefined) updateFields.bio = req.body.bio == "" ? "No Bio" : req.body.bio;
    if (req.body.interests) updateFields.interests = req.body.interests;
    const updatedUser = await UserDetail.findByIdAndUpdate(userId, updateFields, { new: true, runValidators: true })
      .populate("interests").populate("friends");
    if (!updatedUser) return res.status(404).json({ message: "User not found" });
    res.status(200).json(updatedUser);
  } catch (error) {
    console.error("Error updating user:", error);
    res.status(500).json({ message: "Unable to update user" });
  }
});

router.delete("/deleteUser/:uid/", authenticate, loadAuthenticatedUser, async (req, res) => {
  const { uid } = req.params;
  if (!isValidObjectId(uid)) return res.status(400).send({ message: "Invalid user ID" });
  if (uid !== req.user._id.toString()) return res.status(403).json({ message: "You can only delete your own user" });
  try {
    await admin.auth().deleteUser(req.auth.uid);
    const result = await UserDetail.deleteOne({ _id: uid });
    if (result.deletedCount === 1) return res.status(200).send({ message: "User deleted successfully from Firebase and MongoDB" });
    res.status(404).send({ message: "User not found in MongoDB" });
  } catch (error) {
    console.error("Error deleting user:", error);
    res.status(500).send({ message: "Error deleting user" });
  }
});

export default router;
