import UserDetail from "../models/UserDetailSchema.js";
import admin from "../FirebaseAdmin.js";
import { normalizeEmail } from "../utils/validation.js";

export const authenticate = async (req, res, next) => {
  const authorization = req.get("authorization");
  const token = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : null;

  if (!token) {
    return res.status(401).json({ message: "Authentication required" });
  }

  try {
    req.auth = await admin.auth().verifyIdToken(token);
    next();
  } catch (error) {
    console.error("Authentication failed:", error.message);
    res.status(401).json({ message: "Invalid authentication token" });
  }
};

export const loadAuthenticatedUser = async (req, res, next) => {
  try {
    const email = normalizeEmail(req.auth?.email);
    if (!email) {
      return res
        .status(403)
        .json({ message: "Authenticated email is required" });
    }

    let user = await UserDetail.findOne({ firebaseUid: req.auth.uid });
    if (!user) user = await UserDetail.findOne({ email });
    if (!user) {
      return res.status(403).json({ message: "User profile not found" });
    }

    if (!user.firebaseUid) {
      await UserDetail.updateOne(
        { _id: user._id },
        { $set: { firebaseUid: req.auth.uid } }
      );
      user.firebaseUid = req.auth.uid;
    }

    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
};

export const requireOwnUser = (req, res, next) => {
  if (req.params.userId !== req.user._id.toString()) {
    return res
      .status(403)
      .json({ message: "You can only access your own user" });
  }
  next();
};

export const requireAdmin = (req, res, next) => {
  if (req.auth?.admin !== true && req.auth?.role !== "admin") {
    return res.status(403).json({ message: "Administrator access required" });
  }
  next();
};

export { admin };
