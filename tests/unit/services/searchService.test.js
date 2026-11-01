import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const calls = { upserts: [], deletes: [], locks: [], searches: [], users: [] };
let candidates;
let findError;
let lockResults;
const userSearch = {
  findOneAndUpdate: async (...args) => {
    if (args[0]?.isLocked?.$ne === true) {
      calls.locks.push(args);
      return lockResults.shift() ?? null;
    }
    if (args[1]?.isLocked === false && !("query" in args[1])) calls.locks.push(args);
    else calls.upserts.push(args);
    return { acknowledged: true };
  },
  deleteOne: async (...args) => { calls.deletes.push(args); return { deletedCount: 1 }; },
  find: (...args) => {
    calls.searches.push(args);
    return { sort() { return this; }, lean: async () => { if (findError) throw findError; return candidates; } };
  },
};
const userDetail = {
  findOne: async (...args) => { calls.users.push(args); return { _id: args[0]._id, name: "matched user" }; },
};
const nodeMajorVersion = Number(process.versions.node.split(".")[0]);
const defaultMock = (value) => nodeMajorVersion >= 26 ? { exports: { default: value } } : { defaultExport: value };
mock.module(pathToFileURL(resolve(process.cwd(), "models/UserSearchSchema.js")), defaultMock(userSearch));
mock.module(pathToFileURL(resolve(process.cwd(), "models/UserDetailSchema.js")), defaultMock(userDetail));
const { createSearchService } = await import(pathToFileURL(resolve(process.cwd(), "services/searchService.js")));

const fakeTimers = async (operation) => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const scheduled = [];
  const cleared = [];
  let nextTimerId = 1;
  globalThis.setTimeout = (callback, delay) => {
    const timer = { id: nextTimerId++, delay };
    scheduled.push({ callback, timer });
    return timer;
  };
  globalThis.clearTimeout = (timer) => { cleared.push(timer); };
  try { return await operation({ scheduled, cleared }); }
  finally { globalThis.setTimeout = originalSetTimeout; globalThis.clearTimeout = originalClearTimeout; }
};
const makeIO = () => {
  const events = [];
  return {
    events,
    to(room) { return { emit: (name, payload) => events.push({ room, name, payload }) }; },
  };
};
const aliceId = "0123456789abcdef01234567";
const bobId = "abcdef0123456789abcdef01";
beforeEach(() => {
  for (const list of Object.values(calls)) list.length = 0;
  candidates = [];
  findError = null;
  lockResults = [{ _id: aliceId }, { _id: bobId }];
});

test("startSearch normalizes its in-memory room key and persists the query", async () => {
  await fakeTimers(async ({ scheduled }) => {
    const service = createSearchService(makeIO(), { compare: async () => ({ similarity_score: 0 }) });
    assert.equal(service.userRoom(aliceId), `user:${aliceId}`);
    const socket = { id: "socket-a" };
    await service.startSearch(aliceId, "quiet forest", socket);
    assert.deepEqual(calls.upserts, [[{ userId: aliceId }, { query: "quiet forest", created_at: calls.upserts[0][1].created_at, isLocked: false }, { upsert: true }]]);
    assert.ok(calls.upserts[0][1].created_at instanceof Date);
    assert.equal(scheduled.length, 1);
  });
});

test("cleanupSearch cancels its timer, removes its search record, and unlocks its user", async () => {
  await fakeTimers(async ({ scheduled, cleared }) => {
    const service = createSearchService(makeIO(), { compare: async () => ({ similarity_score: 0 }) });
    await service.startSearch(aliceId, "query", { id: "socket-a" });
    await service.cleanupSearch(aliceId);
    assert.ok(cleared.length >= 1);
    assert.ok(cleared.every((timer) => timer === scheduled[0].timer));
    assert.ok(calls.deletes.some(([filter]) => filter.userId === aliceId));
    assert.ok(calls.locks.some(([filter, update]) => filter.userId === aliceId && update.isLocked === false));
  });
});

test("cleanupSocketSearches removes only searches owned by the disconnected socket", async () => {
  await fakeTimers(async ({ cleared }) => {
    const service = createSearchService(makeIO(), { compare: async () => ({ similarity_score: 0 }) });
    await service.startSearch(aliceId, "one", { id: "socket-a" });
    await service.startSearch(bobId, "two", { id: "socket-b" });
    await service.cleanupSocketSearches("socket-a");
    assert.ok(cleared.length >= 1);
    assert.ok(cleared.every((timer) => timer.id === 1));
    assert.equal(calls.deletes.filter(([filter]) => filter.userId === aliceId).length, 2);
    assert.equal(calls.deletes.filter(([filter]) => filter.userId === bobId).length, 1);
  });
});

test("search matches users at or above the similarity threshold and emits to both rooms", async () => {
  await fakeTimers(async ({ scheduled }) => {
    candidates = [{ userId: bobId, query: "a quiet forest", created_at: new Date("2026-01-01T00:00:00Z") }];
    const io = makeIO();
    let comparisons = 0;
    const service = createSearchService(io, { compare: async () => { comparisons++; return { similarity_score: 0.75 }; } });
    await service.startSearch(aliceId, "quiet forest", { id: "socket-a" });
    await scheduled.shift().callback();
    assert.equal(comparisons, 1);
    assert.equal(io.events.length, 2);
    assert.deepEqual(io.events.map(({ room }) => room), [`user:${bobId}`, `user:${aliceId}`]);
    assert.ok(io.events.every(({ name, payload }) => name === "search_update" && payload.matches.similarity === 0.75));
    assert.ok(calls.deletes.some(([filter]) => filter.userId === aliceId));
    assert.ok(calls.deletes.some(([filter]) => filter.userId === bobId));
  });
});

test("search continues polling when the other participant cannot be locked", async () => {
  await fakeTimers(async ({ scheduled }) => {
    candidates = [{ userId: bobId, query: "close match", created_at: new Date() }];
    lockResults = [{ _id: aliceId }, null];
    const io = makeIO();
    const service = createSearchService(io, { compare: async () => ({ similarity_score: 0.9 }) });
    await service.startSearch(aliceId, "query", { id: "socket-a" });
    await scheduled.shift().callback();
    assert.equal(io.events.length, 0);
    assert.ok(calls.locks.some(([filter, update]) => filter.userId === aliceId && update.isLocked === false));
    assert.equal(scheduled.length, 1);
    assert.equal(scheduled[0].timer.delay, 1000);
  });
});

test("search reports a stable error and unlocks its user if candidate lookup fails", async () => {
  await fakeTimers(async ({ scheduled }) => {
    findError = new Error("private database detail");
    const io = makeIO();
    const service = createSearchService(io, { compare: async () => ({ similarity_score: 0 }) });
    await service.startSearch(aliceId, "query", { id: "socket-a" });
    const original = console.error;
    console.error = () => {};
    try { await scheduled.shift().callback(); } finally { console.error = original; }
    assert.deepEqual(io.events, [{ room: `user:${aliceId}`, name: "error", payload: { message: "An error occurred while checking for matches." } }]);
    assert.ok(calls.locks.some(([filter, update]) => filter.userId === aliceId && update.isLocked === false));
  });
});
