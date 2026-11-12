import { Router } from "express";
import { MediaClientError } from "./MediaClientError.js";

export function createAvatarRouter({ authenticate, loadUser, createSession, complete, getProfile, remove }) {
  const router = Router();
  router.post("/v1/me/avatar/uploads", authenticate, loadUser, async (req, res) => {
    try {
      res.status(201).json(await createSession(req.user._id, req.body));
    } catch (error) {
      if (error instanceof MediaClientError && (error.statusCode === 400 || error.statusCode === 429)) return res.status(error.statusCode).json({ message: error.message });
      return res.status(503).json({ message: "Upload session unavailable" });
    }
  });
  router.post("/v1/me/avatar/uploads/:mediaId/complete", authenticate, loadUser, async (req, res) => {
    try {
      await complete(req.user._id, req.params.mediaId);
      const profile = await getProfile(req.user._id);
      res.json({ success: true, avatar: profile.avatar });
    } catch (error) {
      res.status(error instanceof MediaClientError ? error.statusCode : 503).json({ message: error instanceof MediaClientError ? error.message : "Avatar confirmation unavailable" });
    }
  });
  router.get("/v1/me/profile", authenticate, loadUser, async (req, res) => {
    try {
      const profile = await getProfile(req.user._id);
      if (!profile) return res.status(404).json({ message: "Profile not found" });
      res.json(profile);
    } catch { res.status(503).json({ message: "Avatar retrieval unavailable" }); }
  });
  router.delete("/v1/me/avatar", authenticate, loadUser, async (req, res) => {
    try {
      const profile = await remove(req.user._id);
      if (!profile) return res.status(404).json({ message: "Profile not found" });
      res.json(profile);
    } catch { res.status(503).json({ message: "Avatar removal unavailable" }); }
  });
  return router;
}
