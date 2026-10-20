import mongoose from "mongoose";

export const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

export const normalizeEmail = (email) =>
  typeof email === "string" ? email.trim().toLowerCase() : "";

export const normalizeSearchQuery = (query) =>
  typeof query === "string" ? query.trim().replace(/\s+/g, " ") : "";
