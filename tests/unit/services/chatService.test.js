import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

let findByIdAndUpdate = async () => null;
const chatModelMock = { findByIdAndUpdate: (...args) => findByIdAndUpdate(...args) };
const moduleMockOptions = Number(process.versions.node.split(".")[0]) >= 26
  ? { exports: { default: chatModelMock } }
  : { defaultExport: chatModelMock };
const modelUrl = pathToFileURL(resolve(process.cwd(), "models/ChatScema.js"));
mock.module(modelUrl, moduleMockOptions);

const { saveMessage } = await import(pathToFileURL(resolve(process.cwd(), "services/chatService.js")));

test("saveMessage updates the chat identified by chatId", async () => {
  let receivedChatId;
  findByIdAndUpdate = async (chatId) => { receivedChatId = chatId; return { _id: chatId }; };

  await saveMessage("chat-1", { text: "hello" });

  assert.equal(receivedChatId, "chat-1");
});

test("saveMessage appends the message with MongoDB $push", async () => {
  const message = { text: "hello", sender: "user-1" };
  let receivedUpdate;
  findByIdAndUpdate = async (_chatId, update) => { receivedUpdate = update; return {}; };

  await saveMessage("chat-1", message);

  assert.deepEqual(receivedUpdate, { $push: { messages: message } });
});

test("saveMessage requests the updated chat document", async () => {
  let receivedOptions;
  findByIdAndUpdate = async (_chatId, _update, options) => { receivedOptions = options; return {}; };

  await saveMessage("chat-1", { text: "hello" });

  assert.deepEqual(receivedOptions, { new: true });
});

test("saveMessage returns the updated chat document", async () => {
  const updatedChat = { _id: "chat-1", messages: [{ text: "hello" }] };
  findByIdAndUpdate = async () => updatedChat;

  assert.equal(await saveMessage("chat-1", { text: "hello" }), updatedChat);
});

test("saveMessage returns null when the chat does not exist", async () => {
  findByIdAndUpdate = async () => null;

  assert.equal(await saveMessage("missing-chat", { text: "hello" }), null);
});

test("saveMessage logs database errors and rejects with a stable message", async () => {
  const originalError = new Error("database details");
  findByIdAndUpdate = async () => { throw originalError; };
  const originalConsoleError = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args);

  try {
    await assert.rejects(saveMessage("chat-1", { text: "hello" }), {
      name: "Error",
      message: "Error saving message",
    });
  } finally {
    console.error = originalConsoleError;
  }

  assert.deepEqual(logged, [["database details"]]);
});
