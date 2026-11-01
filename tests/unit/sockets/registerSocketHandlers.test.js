import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const calls = { userFind: [], chatExists: [], updates: [], savedMessages: [], starts: [], cleanups: [] };
let verifiedClaims;
let profileResult;
let chatExistsResult;
let savedChat;
const userModel = { findOne: async (...args) => { calls.userFind.push(args); return profileResult; } };
const chatModel = {
  exists: async (...args) => { calls.chatExists.push(args); return chatExistsResult; },
  updateMany: async (...args) => { calls.updates.push(args); },
  updateOne: async (...args) => { calls.updates.push(args); },
};
const auth = { auth: () => ({ verifyIdToken: async () => verifiedClaims }) };
const authMock = { admin: auth };
const chatService = {
  saveMessage: async (...args) => { calls.savedMessages.push(args); return savedChat; },
};
const nodeMajorVersion = Number(process.versions.node.split(".")[0]);
const defaultMock = (value) => nodeMajorVersion >= 26 ? { exports: { default: value } } : { defaultExport: value };
const namedMock = (value) => nodeMajorVersion >= 26 ? { exports: value } : { namedExports: value };
mock.module(pathToFileURL(resolve(process.cwd(), "models/ChatScema.js")), defaultMock(chatModel));
mock.module(pathToFileURL(resolve(process.cwd(), "models/UserDetailSchema.js")), defaultMock(userModel));
mock.module(pathToFileURL(resolve(process.cwd(), "middleware/auth.js")), namedMock(authMock));
mock.module(pathToFileURL(resolve(process.cwd(), "services/chatService.js")), namedMock(chatService));
const { registerSocketHandlers } = await import(pathToFileURL(resolve(process.cwd(), "sockets/registerSocketHandlers.js")));
const userId = "0123456789abcdef01234567";
const chatId = "abcdef0123456789abcdef01";
const createIO = () => {
  const io = { middlewares: [], listeners: {}, outgoing: [], roomEvents: [] };
  io.use = (handler) => io.middlewares.push(handler);
  io.on = (event, handler) => { io.listeners[event] = handler; };
  io.emit = (event, payload) => io.outgoing.push({ event, payload });
  io.to = (room) => ({ emit: (event, payload) => io.roomEvents.push({ room, event, payload }) });
  return io;
};
const createSocket = (id = "socket-1") => ({
  id,
  handshake: { auth: { token: "valid-token" } },
  data: {},
  handlers: {},
  joined: [],
  left: [],
  emitted: [],
  on(event, handler) { this.handlers[event] = handler; },
  join(room) { this.joined.push(room); },
  leave(room) { this.left.push(room); },
  emit(event, payload) { this.emitted.push({ event, payload }); },
});
const quiet = async (operation) => {
  const original = console.log;
  console.log = () => {};
  try { return await operation(); } finally { console.log = original; }
};
const setupConnectedSocket = async () => {
  const io = createIO();
  const searchService = {
    userRoom: (id) => `user:${id}`,
    startSearch: async (...args) => { calls.starts.push(args); },
    cleanupSearch: async (...args) => { calls.cleanups.push(args); },
    cleanupSocketSearches: async (...args) => { calls.cleanups.push(args); },
  };
  registerSocketHandlers(io, searchService);
  const socket = createSocket();
  socket.user = { _id: { toString: () => userId } };
  await quiet(async () => io.listeners.connection(socket));
  return { io, socket, searchService };
};

beforeEach(() => {
  for (const list of Object.values(calls)) list.length = 0;
  verifiedClaims = { uid: "firebase-user", email: "Person@Example.com" };
  profileResult = { _id: { toString: () => userId } };
  chatExistsResult = true;
  savedChat = { messages: [{ content: "hello" }] };
});

test("socket authentication rejects connections without a token", async () => {
  const io = createIO();
  registerSocketHandlers(io, { userRoom: () => "user:test" });
  let authError;
  await io.middlewares[0]({ handshake: { auth: {} } }, (error) => { authError = error; });
  assert.equal(authError.message, "Authentication required");
  assert.equal(calls.userFind.length, 0);
});

test("socket authentication finds the registered profile using normalized email", async () => {
  const io = createIO();
  registerSocketHandlers(io, { userRoom: () => "user:test" });
  const socket = createSocket();
  let authError;
  await io.middlewares[0](socket, (error) => { authError = error; });
  assert.equal(authError, undefined);
  assert.deepEqual(calls.userFind, [[{ $or: [{ firebaseUid: "firebase-user" }, { email: "person@example.com" }] }]]);
  assert.equal(socket.user, profileResult);
  assert.equal(socket.auth, verifiedClaims);
});

test("socket authentication rejects a valid identity without an application profile", async () => {
  profileResult = null;
  const io = createIO();
  registerSocketHandlers(io, { userRoom: () => "user:test" });
  let authError;
  await io.middlewares[0](createSocket(), (error) => { authError = error; });
  assert.equal(authError.message, "User profile not found");
});

test("connection joins the authenticated user's private room", async () => {
  const { socket } = await setupConnectedSocket();
  assert.deepEqual(socket.joined, [`user:${userId}`]);
});

test("submit_keyword trims and collapses query whitespace before starting search", async () => {
  const { socket } = await setupConnectedSocket();
  await socket.handlers.submit_keyword({ userId, query: "  quiet   forest\nwalk " });
  assert.equal(calls.starts.length, 1);
  assert.equal(calls.starts[0][0], userId);
  assert.equal(calls.starts[0][1], "quiet forest walk");
  assert.equal(calls.starts[0][2], socket);
});

test("submit_keyword rejects attempts to search as another user", async () => {
  const { socket } = await setupConnectedSocket();
  await socket.handlers.submit_keyword({ userId: chatId, query: "query" });
  assert.deepEqual(socket.emitted, [{ event: "error", payload: { message: "You can only search as yourself." } }]);
  assert.equal(calls.starts.length, 0);
});

test("joinChat joins only existing chats that include the authenticated user", async () => {
  const { socket } = await setupConnectedSocket();
  await socket.handlers.joinChat({ chatId });
  assert.deepEqual(calls.chatExists, [[{ _id: chatId, participants: socket.user._id }]]);
  assert.deepEqual(socket.joined, [`user:${userId}`, chatId]);
  chatExistsResult = null;
  await socket.handlers.joinChat({ chatId: userId });
  assert.deepEqual(socket.joined, [`user:${userId}`, chatId]);
});

test("sendMessage persists trimmed content and broadcasts only after participant check", async () => {
  const { io, socket } = await setupConnectedSocket();
  await socket.handlers.sendMessage({ chatId, message: { sender: userId, content: "  hello there  " } });
  assert.deepEqual(calls.savedMessages, [[chatId, { sender: userId, content: "hello there", readBy: [userId] }]]);
  assert.deepEqual(io.roomEvents, [{ room: chatId, event: "receiveMessage", payload: { content: "hello" } }]);
  assert.deepEqual(io.outgoing, [{ event: "updateUnreadCounts", payload: undefined }]);
});

test("sendMessage ignores messages that claim a different sender", async () => {
  const { io, socket } = await setupConnectedSocket();
  await socket.handlers.sendMessage({ chatId, message: { sender: chatId, content: "spoofed" } });
  assert.equal(calls.chatExists.length, 0);
  assert.equal(calls.savedMessages.length, 0);
  assert.equal(io.roomEvents.length, 0);
});
