import { Router } from "express";

export function createAvatarRouter({ authenticate, loadUser, createSession }) {
  const router = Router();
  router.post("/v1/me/avatar/uploads", authenticate, loadUser, async (req, res) => {
    try {
      res.status(201).json(await createSession(req.user._id, req.body));
    } catch (error) {
      if (error.statusCode === 400 || error.statusCode === 429) return res.status(error.statusCode).json({ message: error.message });
      return res.status(503).json({ message: "Upload session unavailable" });
    }
  });
  return router;
}
