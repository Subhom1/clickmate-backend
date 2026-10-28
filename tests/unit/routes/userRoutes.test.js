import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const calls = { findOne: [], create: [], findById: [], findByIdAndUpdate: [], deleteOne: [] };
let findOneResult;
let createResult;
let findByIdResult;
let findByIdAndUpdateResult;
let deleteOneResult;
const queryFor = (value) => ({ populate() { return this; }, then(resolveValue, rejectValue) { return Promise.resolve(value).then(resolveValue, rejectValue); } });
const userModelMock = {
  findOne: (...args) => { calls.findOne.push(args); return queryFor(findOneResult); },
  create: async (...args) => { calls.create.push(args); return createResult; },
  findById: (...args) => { calls.findById.push(args); return queryFor(findByIdResult); },
  findByIdAndUpdate: (...args) => { calls.findByIdAndUpdate.push(args); return queryFor(findByIdAndUpdateResult); },
  deleteOne: async (...args) => { calls.deleteOne.push(args); return deleteOneResult; },
};
const authMock = {
  admin: { auth: () => ({ deleteUser: async () => {} }) },
  authenticate(_req, _res, next) { next(); },
  loadAuthenticatedUser(_req, _res, next) { next(); },
  requireOwnUser(_req, _res, next) { next(); },
};
const nodeMajorVersion = Number(process.versions.node.split(".")[0]);
const modelOptions = nodeMajorVersion >= 26 ? { exports: { default: userModelMock } } : { defaultExport: userModelMock };
const authOptions = nodeMajorVersion >= 26 ? { exports: authMock } : { namedExports: authMock };
mock.module(pathToFileURL(resolve(process.cwd(), "models/UserDetailSchema.js")), modelOptions);
mock.module(pathToFileURL(resolve(process.cwd(), "middleware/auth.js")), authOptions);
const { default: router } = await import(pathToFileURL(resolve(process.cwd(), "routes/userRoutes.js")));

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
beforeEach(() => {
  for (const key of Object.keys(calls)) calls[key].length = 0;
  findOneResult = null;
  createResult = { _id: "new-user" };
  findByIdResult = null;
  findByIdAndUpdateResult = null;
  deleteOneResult = { deletedCount: 1 };
});

test("registration rejects a missing name before querying the database", async () => {
  const res = await invoke("/register", "post", { body: {}, auth: { email: "Alice@example.com", uid: "firebase-uid" } });
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.payload, { data: "Name and email are required" });
  assert.equal(calls.findOne.length, 0);
});

test("registration rejects an email that differs from the verified identity", async () => {
  const res = await invoke("/register", "post", { body: { name: "Alice", email: "other@example.com" }, auth: { email: "Alice@example.com", uid: "firebase-uid" } });
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.payload, { data: "Name and email are required" });
  assert.equal(calls.create.length, 0);
});

test("registration returns conflict when the verified email already exists", async () => {
  findOneResult = { _id: "existing-user" };
  const res = await invoke("/register", "post", { body: { name: "Alice" }, auth: { email: "Alice@example.com", uid: "firebase-uid" } });
  assert.equal(res.statusCode, 409);
  assert.deepEqual(res.payload, { data: "User already exists!" });
  assert.deepEqual(calls.findOne[0], [{ email: "alice@example.com" }]);
  assert.equal(calls.create.length, 0);
});

test("registration stores normalized identity fields and returns the created user", async () => {
  const user = { _id: "new-user", fullname: "alice example", email: "alice@example.com" };
  createResult = user;
  const res = await invoke("/register", "post", { body: { name: "  Alice Example  ", email: "ALICE@example.com" }, auth: { email: "Alice@example.com", uid: "firebase-uid" } });
  assert.equal(res.statusCode, 201);
  assert.deepEqual(res.payload, { status: "ok", statusCode: 201, data: user });
  assert.equal(calls.create.length, 1);
  assert.equal(calls.create[0][0].fullname, "alice example");
  assert.equal(calls.create[0][0].email, "alice@example.com");
  assert.equal(calls.create[0][0].firebaseUid, "firebase-uid");
});

test("user lookup rejects another email without querying the database", async () => {
  const res = await invoke("/user/:email", "get", { params: { email: "bob@example.com" }, auth: { email: "Alice@example.com" } });
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.payload, { message: "You can only access your own user" });
  assert.equal(calls.findOne.length, 0);
});

test("user lookup returns 404 when the authenticated account is not registered", async () => {
  const res = await invoke("/user/:email", "get", { params: { email: "ALICE@example.com" }, auth: { email: "Alice@example.com" } });
  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.payload, { message: "User not found" });
  assert.deepEqual(calls.findOne[0], [{ email: "alice@example.com" }]);
});

test("friends route rejects malformed user IDs before querying the database", async () => {
  const res = await invoke("/users/:userId/friends", "get", { params: { userId: "not-an-object-id" } });
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.payload, { message: "Invalid user ID" });
  assert.equal(calls.findById.length, 0);
});
