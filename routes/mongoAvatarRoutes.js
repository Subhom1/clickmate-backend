import { Router } from "express";
import multer from "multer";
import mongoose from "mongoose";
import { authenticate, loadAuthenticatedUser } from "../middleware/auth.js";
import UserDetail from "../models/UserDetailSchema.js";
import AvatarFile from "../models/AvatarFile.js";
import { createMongoAvatarService } from "../services/media/mongoAvatar.js";

const router = Router();
const service = createMongoAvatarService({ users: UserDetail, files: AvatarFile });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1, fields: 0 } }).single("file");

router.post("/v1/me/avatar-file", authenticate, loadAuthenticatedUser, (req, res, next) => {
  upload(req, res, error => {
    if (error) return res.status(400).json({ message: "INVALID_SIZE_OR_UPLOAD" });
    next();
  });
}, async (req, res) => {
  try {
    const avatar = await service.save(req.user._id, req.file);
    res.status(201).json({ avatar });
  } catch (error) {
    res.status(error.statusCode || 503).json({ message: error.statusCode ? error.message : "Avatar upload unavailable" });
  }
});

router.get("/v1/me/avatar-file", authenticate, loadAuthenticatedUser, async (req, res) => {
  try {
    const avatar = await service.get(req.user._id);
    if (avatar === undefined) return res.status(404).json({ message: "Profile not found" });
    res.json({ avatar });
  } catch { res.status(503).json({ message: "Avatar retrieval unavailable" }); }
});

router.get("/v1/avatar-files/:mediaId", authenticate, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.mediaId)) return res.status(400).json({ message: "Invalid avatar ID" });
  try {
    const file = await service.read(req.params.mediaId);
    if (!file) return res.status(404).json({ message: "Avatar not found" });
    res.set("Content-Type", "image/jpeg");
    res.set("Cache-Control", "private, max-age=300");
    res.send(file.bytes);
  } catch { res.status(503).json({ message: "Avatar retrieval unavailable" }); }
});

router.delete("/v1/me/avatar-file", authenticate, loadAuthenticatedUser, async (req, res) => {
  try {
    const avatar = await service.remove(req.user._id);
    if (avatar === undefined) return res.status(404).json({ message: "Profile not found" });
    res.json({ avatar: null });
  } catch { res.status(503).json({ message: "Avatar removal unavailable" }); }
});

export default router;
