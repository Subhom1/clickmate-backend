import { Router } from "express";
import Explore from "../models/ExploreSchema.js";
import Interest from "../models/InterestSchema.js";
import { authenticate, requireAdmin } from "../middleware/auth.js";
import { upload, removeUploadedFiles, validateUploadedSignatures } from "../middleware/upload.js";
import { isValidObjectId } from "../utils/validation.js";

const router = Router();

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
  const files = req.files;
  if (!isValidObjectId(categoryId)) return res.status(400).send({ message: "Invalid category ID" });
  if (!req.body.items) return res.status(400).send({ message: "No items provided." });
  try {
    await validateUploadedSignatures(files || []);
    const parsedItems = JSON.parse(req.body.items);
    if (!Array.isArray(parsedItems)) return res.status(400).send({ message: "Items must be an array." });
    if (parsedItems.length === 0 || parsedItems.length > 10) return res.status(400).send({ message: "Items must contain between 1 and 10 entries." });
    if (!files || files.length !== parsedItems.length) return res.status(400).send({ message: "Each item must include exactly one image." });
    const itemData = parsedItems.map((item, index) => {
      const text = typeof item.text === "string" ? item.text.trim() : "";
      if (!text || text.length > 500) throw new Error("Each item text must be between 1 and 500 characters");
      return { text, imgUrl: `/uploads/${files[index].filename}` };
    });
    res.status(200).json(await Explore.findByIdAndUpdate(categoryId, { $push: { list: { $each: itemData } } }, { new: true, upsert: true }));
  } catch (error) {
    await removeUploadedFiles(files);
    console.error("Error adding items:", error);
    res.status(400).send({ message: "Unable to add items" });
  }
});

export default router;
