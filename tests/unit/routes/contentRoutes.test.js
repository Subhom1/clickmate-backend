import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const calls = { interestFind: 0, exploreFind: 0, exploreCreate: [], updates: [], validation: [], removed: [] };
let interestsValue;
let exploreValue;
let createdCategory;
let updateResult;
let validationError;
let removeError;
const interestModel = { find: async () => { calls.interestFind++; if (interestsValue instanceof Error) throw interestsValue; return interestsValue; } };
const exploreModel = {
  find: async () => { calls.exploreFind++; if (exploreValue instanceof Error) throw exploreValue; return exploreValue; },
  create: async (...args) => { calls.exploreCreate.push(args); if (createdCategory instanceof Error) throw createdCategory; return createdCategory; },
  findByIdAndUpdate: async (...args) => { calls.updates.push(args); if (updateResult instanceof Error) throw updateResult; return updateResult; },
};
const uploadMiddleware = () => {};
let validateUploadedSignatures = async (files) => { calls.validation.push(files); if (validationError) throw validationError; };
let removeUploadedFiles = async (files) => { calls.removed.push(files); if (removeError) throw removeError; };
const uploadMock = { upload: uploadMiddleware, removeUploadedFiles: (...args) => removeUploadedFiles(...args), validateUploadedSignatures: (...args) => validateUploadedSignatures(...args) };
const authMock = { authenticate(_req, _res, next) { next(); }, requireAdmin(_req, _res, next) { next(); } };
const nodeMajorVersion = Number(process.versions.node.split(".")[0]);
const defaultMock = (value) => nodeMajorVersion >= 26 ? { exports: { default: value } } : { defaultExport: value };
const namedMock = (value) => nodeMajorVersion >= 26 ? { exports: value } : { namedExports: value };
mock.module(pathToFileURL(resolve(process.cwd(), "models/ExploreSchema.js")), defaultMock(exploreModel));
mock.module(pathToFileURL(resolve(process.cwd(), "models/InterestSchema.js")), defaultMock(interestModel));
mock.module(pathToFileURL(resolve(process.cwd(), "middleware/auth.js")), namedMock(authMock));
mock.module(pathToFileURL(resolve(process.cwd(), "middleware/upload.js")), namedMock(uploadMock));
const { default: router } = await import(pathToFileURL(resolve(process.cwd(), "routes/contentRoutes.js")));

const handlerFor = (path, method) => {
  const layer = router.stack.find((entry) => entry.route?.path === path && entry.route.methods[method]);
  assert.ok(layer, `Expected ${method.toUpperCase()} ${path} route`);
  return layer.route.stack.at(-1).handle;
};
const responseRecorder = () => ({
  statusCode: 200,
  payload: undefined,
  status(code) { this.statusCode = code; return this; },
  send(payload) { this.payload = payload; return this; },
  json(payload) { this.payload = payload; return this; },
});
const invoke = async (path, method, req) => {
  const res = responseRecorder();
  await handlerFor(path, method)(req, res);
  return res;
};
const quiet = async (operation) => {
  const original = console.error;
  console.error = () => {};
  try { return await operation(); } finally { console.error = original; }
};
beforeEach(() => {
  for (const key of Object.keys(calls)) {
    if (Array.isArray(calls[key])) calls[key].length = 0;
    else calls[key] = 0;
  }
  interestsValue = [{ name: "Music" }];
  exploreValue = [{ category: "Outdoors", list: [] }];
  createdCategory = { _id: "category-id", category: "Music", list: [] };
  updateResult = { _id: "category-id", list: [] };
  validationError = null;
  removeError = null;
  validateUploadedSignatures = async (files) => { calls.validation.push(files); if (validationError) throw validationError; };
  removeUploadedFiles = async (files) => { calls.removed.push(files); if (removeError) throw removeError; };
});

test("interests route returns the available interests", async () => {
  const res = await invoke("/interests", "get", { params: {} });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload, [{ name: "Music" }]);
  assert.equal(calls.interestFind, 1);
});

test("interests route maps database failures to a stable server error", async () => {
  interestsValue = new Error("database secret");
  const res = await quiet(() => invoke("/interests", "get", { params: {} }));
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.payload, { message: "Unable to fetch interests" });
});

test("explore route returns the available categories", async () => {
  const res = await invoke("/explore", "get", { params: {} });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload, [{ category: "Outdoors", list: [] }]);
  assert.equal(calls.exploreFind, 1);
});

test("add category trims the category name and initializes an empty list", async () => {
  const res = await invoke("/add-explore-category", "post", { body: { category: "  Music  " } });
  assert.equal(res.statusCode, 201);
  assert.equal(res.payload, createdCategory);
  assert.deepEqual(calls.exploreCreate, [[{ category: "Music", list: [] }]]);
});

test("add category rejects a blank category", async () => {
  const res = await invoke("/add-explore-category", "post", { body: { category: "   " } });
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.payload, { message: "Category is required." });
  assert.equal(calls.exploreCreate.length, 0);
});

test("add category rejects names longer than 100 characters", async () => {
  const res = await invoke("/add-explore-category", "post", { body: { category: "x".repeat(101) } });
  assert.equal(res.statusCode, 400);
  assert.equal(calls.exploreCreate.length, 0);
});

test("add items rejects an invalid category ID before inspecting files", async () => {
  const res = await invoke("/add-items/:categoryId", "post", { params: { categoryId: "bad-id" }, body: { items: "[]" }, files: [] });
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.payload, { message: "Invalid category ID" });
  assert.equal(calls.validation.length, 0);
});

test("add items requires item data", async () => {
  const res = await invoke("/add-items/:categoryId", "post", { params: { categoryId: "0123456789abcdef01234567" }, body: {}, files: [] });
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.payload, { message: "No items provided." });
  assert.equal(calls.validation.length, 0);
});

test("add items appends trimmed item text and uploaded image paths", async () => {
  const files = [{ filename: "images-one.png", path: "/tmp/images-one.png", mimetype: "image/png" }];
  const categoryId = "0123456789abcdef01234567";
  const res = await invoke("/add-items/:categoryId", "post", {
    params: { categoryId }, body: { items: JSON.stringify([{ text: "  A trail  " }]) }, files,
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload, updateResult);
  assert.deepEqual(calls.validation, [files]);
  assert.deepEqual(calls.updates, [[categoryId, { $push: { list: { $each: [{ text: "A trail", imgUrl: "/uploads/images-one.png" }] } } }, { new: true, upsert: true }]]);
});

test("add items removes uploaded files when item JSON is malformed", async () => {
  const files = [{ filename: "bad.png", path: "/tmp/bad.png", mimetype: "image/png" }];
  const res = await quiet(() => invoke("/add-items/:categoryId", "post", {
    params: { categoryId: "0123456789abcdef01234567" }, body: { items: "{" }, files,
  }));
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.payload, { message: "Unable to add items" });
  assert.deepEqual(calls.removed, [files]);
  assert.equal(calls.updates.length, 0);
});
