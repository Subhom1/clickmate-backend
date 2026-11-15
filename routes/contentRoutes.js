import { Router } from "express";
import Explore from "../models/ExploreSchema.js";
import Interest from "../models/InterestSchema.js";
import { authenticate, requireAdmin } from "../middleware/auth.js";
import { upload, removeUploadedFiles, validateUploadedSignatures } from "../middleware/upload.js";
import { isValidObjectId } from "../utils/validation.js";

const router = Router();

class InvalidExploreItemsError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

// Turn the submitted item text and uploaded filenames into category entries.
function buildExploreItems(rawItems, files) {
  if (!rawItems) throw new InvalidExploreItemsError("No items provided.");

  let items;
  try {
    items = JSON.parse(rawItems);
  } catch {
    throw new InvalidExploreItemsError("Unable to add items");
  }
  if (!Array.isArray(items)) throw new InvalidExploreItemsError("Items must be an array.");
  if (items.length < 1 || items.length > 10) {
    throw new InvalidExploreItemsError("Items must contain between 1 and 10 entries.");
  }
  if (files.length !== items.length) {
    throw new InvalidExploreItemsError("Each item must include exactly one image.");
  }

  return items.map((item, index) => {
    const text = typeof item?.text === "string" ? item.text.trim() : "";
    if (!text || text.length > 500) {
      throw new InvalidExploreItemsError("Each item text must be between 1 and 500 characters.");
    }
    return { text, imgUrl: `/uploads/${files[index].filename}` };
  });
}

router.get("/interests", async (req, res) => {
  try { res.status(200).json(await Interest.find()); }
  catch (error) { console.error("Error fetching interests:", error); res.status(500).json({ message: "Unable to fetch interests" }); }
});

router.get("/explore", async (req, res) => {
  try { res.status(200).json(await Explore.find()); }
  catch (error) { console.error("Error fetching explore categories:", error); res.status(500).json({ message: "Unable to fetch explore categories" }); }
});

router.post("/add-explore-category", authenticate, requireAdmin, async (req, res) => {
  const category = typeof req.body.category === "string" ? req.body.category.trim() : "";
  if (!category || category.length > 100) return res.status(400).json({ message: "Category is required." });
  try { res.status(201).json(await Explore.create({ category, list: [] })); }
  catch (error) { console.error("Error saving the category:", error); res.status(500).json({ message: "Unable to save the category" }); }
});

router.post("/add-items/:categoryId", authenticate, requireAdmin, upload, async (req, res) => {
  const { categoryId } = req.params;
  const files = req.files || [];
  let saved = false;
  try {
    if (!isValidObjectId(categoryId)) throw new InvalidExploreItemsError("Invalid category ID");
    const itemData = buildExploreItems(req.body?.items, files);
    await validateUploadedSignatures(files);
    const category = await Explore.findByIdAndUpdate(
      categoryId,
      { $push: { list: { $each: itemData } } },
      { new: true, runValidators: true }
    );
    if (!category) throw new InvalidExploreItemsError("Category not found", 404);
    saved = true;
    res.status(200).json(category);
  } catch (error) {
    if (!(error instanceof InvalidExploreItemsError)) console.error("Error adding items:", error);
    const statusCode = error instanceof InvalidExploreItemsError
      ? error.statusCode
      : error.message?.includes("image type") ? 400 : 500;
    res.status(statusCode)
      .send({ message: error instanceof InvalidExploreItemsError ? error.message : "Unable to add items" });
  } finally {
    // Multer saves files before this handler runs, so every failed request must remove them.
    if (!saved && files.length) {
      try { await removeUploadedFiles(files); }
      catch (error) { console.error("Unable to remove failed explore uploads:", error); }
    }
  }
});

export default router;
