import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const calls = { findOne: [], updateOne: [], userUpdates: [], saves: 0, find: [] };
let findOneResult;
let findOneError;
let updateError;
let findResult;
let findError;
class Chat {
  constructor(document) { Object.assign(this, document); this._id = "new-chat-id"; }
  async save() { calls.saves++; return this; }
  static async findOne(...args) { calls.findOne.push(args); if (findOneError) throw findOneError; return findOneResult; }
  static async updateOne(...args) { calls.updateOne.push(args); if (updateError) throw updateError; return { modifiedCount: 1 }; }
  static async find(...args) { calls.find.push(args); if (findError) throw findError; return findResult; }
}
const userModel = {
  findByIdAndUpdate: async (...args) => { calls.userUpdates.push(args); return { acknowledged: true }; },
};
const authMock = {
  authenticate(_req, _res, next) { next(); },
  loadAuthenticatedUser(_req, _res, next) { next(); },
  requireOwnUser(_req, _res, next) { next(); },
};
const nodeMajorVersion = Number(process.versions.node.split(".")[0]);
const defaultMock = (value) => nodeMajorVersion >= 26 ? { exports: { default: value } } : { defaultExport: value };
const namedMock = (value) => nodeMajorVersion >= 26 ? { exports: value } : { namedExports: value };
mock.module(pathToFileURL(resolve(process.cwd(), "models/ChatScema.js")), defaultMock(Chat));
mock.module(pathToFileURL(resolve(process.cwd(), "models/UserDetailSchema.js")), defaultMock(userModel));
mock.module(pathToFileURL(resolve(process.cwd(), "middleware/auth.js")), namedMock(authMock));
const { default: router } = await import(pathToFileURL(resolve(process.cwd(), "routes/chatRoutes.js")));

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
const aliceId = "0123456789abcdef01234567";
const bobId = "abcdef0123456789abcdef01";
const user = (id) => ({ _id: { toString: () => id } });
beforeEach(() => {
  for (const key of Object.keys(calls)) {
    if (Array.isArray(calls[key])) calls[key].length = 0;
    else calls[key] = 0;
  }
  findOneResult = null;
  findOneError = null;
  updateError = null;
  findResult = [];
  findError = null;
});

test("create-chat requires both participant IDs", async () => {
  const res = await invoke("/create-chat", "post", { body: { user1Id: aliceId }, user: user(aliceId) });
  assert.equal(res.statusCode, 400);
  assert.equal(res.payload, "User IDs are required");
  assert.equal(calls.findOne.length, 0);
});

test("create-chat rejects malformed participant IDs before querying", async () => {
  const res = await invoke("/create-chat", "post", { body: { user1Id: "bad", user2Id: bobId }, user: user(aliceId) });
  assert.equal(res.statusCode, 400);
  assert.equal(res.payload, "Invalid user IDs");
  assert.equal(calls.findOne.length, 0);
});

test("create-chat rejects a self conversation", async () => {
  const res = await invoke("/create-chat", "post", { body: { user1Id: aliceId, user2Id: aliceId }, user: user(aliceId) });
  assert.equal(res.statusCode, 400);
  assert.equal(res.payload, "A user cannot chat with themselves");
  assert.equal(calls.findOne.length, 0);
});

test("create-chat prevents a nonparticipant from creating a conversation", async () => {
  const res = await invoke("/create-chat", "post", { body: { user1Id: bobId, user2Id: "fedcba9876543210fedcba98" }, user: user(aliceId) });
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.payload, { message: "You must be a chat participant" });
  assert.equal(calls.findOne.length, 0);
});

test("create-chat returns an existing conversation and backfills its canonical key", async () => {
  const existing = { _id: "legacy-chat", participants: [aliceId, bobId] };
  findOneResult = existing;
  const res = await invoke("/create-chat", "post", { body: { user1Id: bobId, user2Id: aliceId }, user: user(aliceId) });
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload, existing);
  assert.deepEqual(calls.findOne[0], [{ $or: [{ conversationKey: `${aliceId}:${bobId}` }, { participants: { $all: [bobId, aliceId] } }] }]);
  assert.deepEqual(calls.updateOne, [[{ _id: "legacy-chat" }, { $set: { conversationKey: `${aliceId}:${bobId}` } }]]);
  assert.equal(calls.userUpdates.length, 0);
});

test("create-chat updates both friend lists before saving a new conversation", async () => {
  const res = await invoke("/create-chat", "post", { body: { user1Id: aliceId, user2Id: bobId }, user: user(bobId) });
  assert.equal(res.statusCode, 201);
  assert.equal(res.payload.conversationKey, `${aliceId}:${bobId}`);
  assert.deepEqual(res.payload.participants, [aliceId, bobId]);
  assert.equal(calls.userUpdates.length, 2);
  assert.deepEqual(calls.userUpdates[0], [aliceId, { $addToSet: { friends: bobId } }, { new: true, runValidators: true }]);
  assert.deepEqual(calls.userUpdates[1], [bobId, { $addToSet: { friends: aliceId } }, { new: true, runValidators: true }]);
  assert.equal(calls.saves, 1);
});

test("chat lookup rejects malformed IDs", async () => {
  const res = await invoke("/chat/:user1Id/:user2Id", "get", { params: { user1Id: "bad", user2Id: bobId }, user: user(aliceId) });
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.payload, { msg: "Invalid user IDs" });
  assert.equal(calls.findOne.length, 0);
});

test("chat lookup prevents nonparticipants from reading a conversation", async () => {
  const res = await invoke("/chat/:user1Id/:user2Id", "get", { params: { user1Id: bobId, user2Id: "fedcba9876543210fedcba98" }, user: user(aliceId) });
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.payload, { message: "You must be a chat participant" });
  assert.equal(calls.findOne.length, 0);
});

test("chat lookup returns not found when no shared conversation exists", async () => {
  const res = await invoke("/chat/:user1Id/:user2Id", "get", { params: { user1Id: aliceId, user2Id: bobId }, user: user(aliceId) });
  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.payload, { msg: "Chat not found" });
  assert.deepEqual(calls.findOne[0], [{ participants: { $all: [aliceId, bobId] } }]);
});

test("chat lookup returns the matching conversation", async () => {
  const conversation = { _id: "chat-1", participants: [aliceId, bobId], messages: [] };
  findOneResult = conversation;
  const res = await invoke("/chat/:user1Id/:user2Id", "get", { params: { user1Id: aliceId, user2Id: bobId }, user: user(bobId) });
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload, conversation);
});

test("chat lookup maps database failures to a server error", async () => {
  findOneError = new Error("private database detail");
  const res = await quiet(() => invoke("/chat/:user1Id/:user2Id", "get", { params: { user1Id: aliceId, user2Id: bobId }, user: user(aliceId) }));
  assert.equal(res.statusCode, 500);
  assert.equal(res.payload, "Server Error");
});

test("unread-messages rejects malformed user IDs before querying", async () => {
  const res = await invoke("/unread-messages/:userId", "get", { params: { userId: "bad" }, user: user(aliceId) });
  assert.equal(res.statusCode, 400);
  assert.equal(res.payload, "Invalid user ID");
  assert.equal(calls.find.length, 0);
});

test("unread-messages reports unread message counts and the other participant", async () => {
  findResult = [
    { participants: [aliceId, bobId], messages: [{ readBy: [] }, { readBy: [aliceId] }, { readBy: [bobId] }] },
    { participants: [aliceId, "fedcba9876543210fedcba98"], messages: [] },
  ];
  const res = await invoke("/unread-messages/:userId", "get", { params: { userId: aliceId }, user: user(aliceId) });
  assert.deepEqual(res.payload, [{ userId: bobId, count: 2 }, { userId: "fedcba9876543210fedcba98", count: 0 }]);
  assert.deepEqual(calls.find, [[{ participants: aliceId }]]);
});

test("unread-messages converts database failures to a server error", async () => {
  findError = new Error("private database detail");
  const res = await quiet(() => invoke("/unread-messages/:userId", "get", { params: { userId: aliceId }, user: user(aliceId) }));
  assert.equal(res.statusCode, 500);
  assert.equal(res.payload, "Server error");
});
