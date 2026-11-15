import mongoose from "mongoose";

export const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

export const normalizeEmail = (email) =>
  typeof email === "string" ? email.trim().toLowerCase() : "";

export const normalizeSearchQuery = (query) =>
  typeof query === "string" ? query.trim().replace(/\s+/g, " ") : "";

export const isValidSearchDate = (date) => {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
};

export const isValidSearchTime = (time) =>
  typeof time === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time);
