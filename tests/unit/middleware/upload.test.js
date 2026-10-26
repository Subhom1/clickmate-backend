import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  removeUploadedFiles,
  validateUploadedSignatures,
} from "../../../middleware/upload.js";

const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p0sAAAAASUVORK5CYII=",
  "base64"
);

const withTempDirectory = async (run) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "clickmate-upload-test-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};

test("validateUploadedSignatures accepts a PNG whose bytes match its MIME type", async () => {
  await withTempDirectory(async (directory) => {
    const filePath = path.join(directory, "image.png");
    await writeFile(filePath, onePixelPng);

    await assert.doesNotReject(() =>
      validateUploadedSignatures([{ path: filePath, mimetype: "image/png" }])
    );
  });
});

test("validateUploadedSignatures rejects bytes declared as a different image MIME type", async () => {
  await withTempDirectory(async (directory) => {
    const filePath = path.join(directory, "image.png");
    await writeFile(filePath, onePixelPng);

    await assert.rejects(
      validateUploadedSignatures([{ path: filePath, mimetype: "image/jpeg" }]),
      /content does not match/
    );
  });
});

test("validateUploadedSignatures rejects files with an unsupported signature", async () => {
  await withTempDirectory(async (directory) => {
    const filePath = path.join(directory, "notes.txt");
    await writeFile(filePath, "not an image");

    await assert.rejects(
      validateUploadedSignatures([{ path: filePath, mimetype: "image/png" }]),
      /content does not match/
    );
  });
});

test("validateUploadedSignatures accepts an empty file list", async () => {
  await assert.doesNotReject(() => validateUploadedSignatures([]));
});

test("removeUploadedFiles deletes each uploaded file", async () => {
  await withTempDirectory(async (directory) => {
    const filePath = path.join(directory, "uploaded.png");
    await writeFile(filePath, onePixelPng);

    await removeUploadedFiles([{ path: filePath }]);

    await assert.rejects(readFile(filePath), { code: "ENOENT" });
  });
});

test("removeUploadedFiles tolerates missing files and an empty list", async () => {
  await assert.doesNotReject(() =>
    removeUploadedFiles([{ path: path.join(os.tmpdir(), "clickmate-file-not-present") }])
  );
  await assert.doesNotReject(() => removeUploadedFiles());
});
