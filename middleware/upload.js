import multer from "multer";
import path from "path";
import { randomUUID } from "crypto";
import { unlink } from "fs/promises";
import { fileTypeFromFile } from "file-type";

const checkFileType = (file, cb) => {
  const allowedTypes = new Map([
    [".jpeg", "image/jpeg"],
    [".jpg", "image/jpeg"],
    [".png", "image/png"],
    [".gif", "image/gif"],
  ]);
  const mimetype = allowedTypes.get(path.extname(file.originalname).toLowerCase());

  if (mimetype === file.mimetype) return cb(null, true);
  cb(new Error("Only JPEG, PNG, and GIF images are allowed"));
};

export const upload = multer({
  storage: multer.diskStorage({
    destination: "./public/uploads/",
    filename: (req, file, cb) => {
      cb(
        null,
        `${file.fieldname}-${Date.now()}-${randomUUID()}${path.extname(file.originalname)}`
      );
    },
  }),
  limits: { fileSize: 5000000, files: 10, fields: 20, fieldSize: 100000 },
  fileFilter: checkFileType,
}).array("images", 10);

export const removeUploadedFiles = async (files = []) => {
  await Promise.all(files.map((file) => unlink(file.path).catch(() => undefined)));
};

export const validateUploadedSignatures = async (files) => {
  const allowed = new Set(["image/jpeg", "image/png", "image/gif"]);
  for (const file of files) {
    const detected = await fileTypeFromFile(file.path);
    if (!detected || !allowed.has(detected.mime) || detected.mime !== file.mimetype) {
      throw new Error("Uploaded file content does not match an allowed image type");
    }
  }
};
