import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const calls = { upserts: [], deletes: [], locks: [], searches: [], users: [] };
let candidates;
let findError;
let lockResults;
let userFindError;
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
  findOne: async (...args) => { calls.users.push(args); if (userFindError) throw userFindError; return { _id: args[0]._id, name: "matched user" }; },
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
  userFindError = null;
  lockResults = [{ _id: aliceId }, { _id: bobId }];
});

test("startSearch persists text with optional date and time", async () => {
  await fakeTimers(async ({ scheduled }) => {
    const service = createSearchService(makeIO(), { compare: async () => ({ similarity_score: 0 }) });
    assert.equal(service.userRoom(aliceId), `user:${aliceId}`);
    const socket = { id: "socket-a" };
    await service.startSearch(aliceId, "quiet forest", socket, { date: "2028-02-29", time: "14:30" });
    assert.deepEqual(calls.upserts, [[
      { userId: aliceId },
      { searchId: calls.upserts[0][1].searchId, query: "quiet forest", date: "2028-02-29", time: "14:30", timeZone: null, utcOffsetMinutes: null, availabilityStart: null, availabilityEnd: null, created_at: calls.upserts[0][1].created_at, isLocked: false },
      { upsert: true, runValidators: true },
    ]]);
    assert.ok(calls.upserts[0][1].created_at instanceof Date);
    assert.equal(scheduled.length, 1);
  });
});

test("each sequential search replacement persists a fresh UUID", async () => {
  await fakeTimers(async () => {
    const service = createSearchService(makeIO(), { compare: async () => ({ similarity_score: 0 }) });
    const socket = { id: "socket-a" };
    await service.startSearch(aliceId, "first", socket);
    await service.startSearch(aliceId, "second", socket);
    const [first, second] = calls.upserts.map(([, update]) => update.searchId);
    const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    assert.match(first, uuidV4);
    assert.match(second, uuidV4);
    assert.notEqual(first, second);
    assert.deepEqual(calls.upserts.map(([filter]) => filter), [{ userId: aliceId }, { userId: aliceId }]);
  });
});

test("a text-only replacement clears an earlier search date and time", async () => {
  await fakeTimers(async () => {
    const service = createSearchService(makeIO(), { compare: async () => ({ similarity_score: 0 }) });
    const socket = { id: "socket-a" };
    await service.startSearch(aliceId, "shopping", socket, { date: "2028-02-29", time: "14:30" });
    await service.startSearch(aliceId, "shopping", socket);
    assert.equal(calls.upserts[1][1].date, null);
    assert.equal(calls.upserts[1][1].time, null);
  });
});

test("scheduled search filters by shared date and nearby time before comparing text", async () => {
  await fakeTimers(async ({ scheduled }) => {
    candidates = [
      { userId: bobId, query: "shopping buddy", date: "2028-03-01", time: "14:30", created_at: new Date() },
      { userId: bobId, query: "shopping buddy", date: "2028-02-29", time: "16:00", created_at: new Date() },
      { userId: bobId, query: "shopping buddy", date: "2028-02-29", time: "15:00", created_at: new Date() },
    ];
    let comparisons = 0;
    const service = createSearchService(makeIO(), { compare: async () => { comparisons++; return { similarity_score: 0.8 }; } });
    await service.startSearch(aliceId, "shop together", { id: "socket-a" }, { date: "2028-02-29", time: "14:30" });
    await scheduled.shift().callback();
    assert.equal(comparisons, 1);
    assert.deepEqual(calls.searches[0][0], {
      isLocked: false,
      userId: { $ne: aliceId },
      availabilityStart: null,
      $and: [
        { $or: [{ date: "2028-02-29" }, { date: null }] },
        { $or: [{ time: { $gte: "13:30", $lte: "15:30" } }, { time: null }] },
      ],
    });
  });
});

test("text-only searches remain compatible with optional schedules", async () => {
  await fakeTimers(async ({ scheduled }) => {
    candidates = [{ userId: bobId, query: "shopping buddy", date: "2028-02-29", time: "14:30", created_at: new Date() }];
    let comparisons = 0;
    const service = createSearchService(makeIO(), { compare: async () => { comparisons++; return { similarity_score: 0.8 }; } });
    await service.startSearch(aliceId, "shop together", { id: "socket-a" });
    await scheduled.shift().callback();
    assert.equal(comparisons, 1);
    assert.deepEqual(calls.searches[0][0], { isLocked: false, userId: { $ne: aliceId } });
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
    assert.ok(calls.locks.some(([filter, update]) => filter._id === aliceId && filter.isLocked === true && update.isLocked === false));
    assert.equal(scheduled.length, 1);
    assert.equal(scheduled[0].timer.delay, 1000);
  });
});

test("metrics count candidates, uncached comparisons and failed claims without exposing search data", async () => {
  await fakeTimers(async ({ scheduled }) => {
    candidates = [{ userId: bobId, query: "private candidate", created_at: new Date() }];
    lockResults = [{ _id: aliceId }, null, { _id: aliceId }, { _id: bobId }];
    const service = createSearchService(makeIO(), { compare: async () => ({ similarity_score: 0.9 }) });
    await service.startSearch(aliceId, "private query", { id: "socket-a" });
    assert.equal(service.getMetrics().activeSearches, 1);
    await scheduled.shift().callback();
    await scheduled.shift().callback();
    const report = service.getMetrics();
    assert.equal(report.candidates, 2);
    assert.equal(report.comparisons, 1);
    assert.equal(report.failedPairClaims, 1);
    assert.equal(report.matches, 1);
    assert.equal(report.activeSearches, 0);
    assert.ok(report.matchLatencyMsTotal >= 0);
    assert.equal(report.matchLatencyMsTotal, report.matchLatencyMsMax);
    assert.doesNotMatch(JSON.stringify(report), /private|012345/);
    report.matches = 99;
    assert.equal(service.getMetrics().matches, 1);
  });
});

test("metrics distinguish stopped searches and timeouts", async () => {
  await fakeTimers(async ({ scheduled }) => {
    const service = createSearchService(makeIO(), { compare: async () => ({ similarity_score: 0 }) });
    await service.startSearch(aliceId, "first", { id: "socket-a" });
    await service.cleanupSearch(aliceId);
    assert.equal(service.getMetrics().cancellations, 1);
    scheduled.shift();
    await service.startSearch(bobId, "second", { id: "socket-b" });
    for (let attempt = 0; attempt < 30; attempt++) await scheduled.shift().callback();
    assert.equal(service.getMetrics().timeouts, 1);
    assert.equal(service.getMetrics().activeSearches, 0);
  });
});

test("combined test report contains search and worker observations", async () => {
  await fakeTimers(async () => {
    const similarity = { getMetrics: () => ({ embeddings: 2, pending: 1, maxPending: 2, workerFailures: 0 }) };
    const service = createSearchService(makeIO(), similarity);
    await service.startSearch(aliceId, "private text", { id: "socket-a" });
    const report = service.getMetricsReport();
    assert.equal(report.search.activeSearches, 1);
    assert.deepEqual(report.worker, { embeddings: 2, pending: 1, maxPending: 2, workerFailures: 0 });
    assert.doesNotMatch(JSON.stringify(report), /private|012345/);
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

test("a committed match stops the other user's in-flight search and timer", async () => {
  await fakeTimers(async ({ scheduled, cleared }) => {
    candidates = [{ userId: bobId, query: "a quiet forest", created_at: new Date() }];
    let releaseComparison;
    let comparisons = 0;
    const pending = new Promise((resolve) => { releaseComparison = resolve; });
    const io = makeIO();
    const service = createSearchService(io, {
      compare: async () => {
        comparisons++;
        return comparisons === 1 ? pending : { similarity_score: 0.9 };
      },
    });
    await service.startSearch(aliceId, "forest", { id: "socket-a" });
    await service.startSearch(bobId, "forest", { id: "socket-b" });
    const aliceTimer = scheduled[0];
    const bobTimer = scheduled[1];
    const inFlight = bobTimer.callback();
    await Promise.resolve();
    await Promise.resolve();
    await aliceTimer.callback();
    assert.equal(io.events.length, 2);
    assert.ok(cleared.includes(bobTimer.timer));
    releaseComparison({ similarity_score: 0.9 });
    await inFlight;
    assert.equal(io.events.length, 2);
    assert.equal(scheduled.length, 2, "cancelled work must not schedule another check");
    assert.equal(service.getMetrics().timeouts, 0);
  });
});

test("cancellation during the final comparison cannot emit or delete again", async () => {
  await fakeTimers(async ({ scheduled }) => {
    candidates = [{ userId: bobId, query: "candidate", created_at: new Date() }];
    let releaseComparison;
    let comparisonStarted;
    const started = new Promise((resolve) => { comparisonStarted = resolve; });
    const pending = new Promise((resolve) => { releaseComparison = resolve; });
    const io = makeIO();
    const service = createSearchService(io, { compare: async () => { comparisonStarted(); return pending; } });
    await service.startSearch(aliceId, "query", { id: "socket-a" });
    const inFlight = scheduled[0].callback();
    await started;
    await service.cleanupSearch(aliceId);
    const deletesAfterCancel = calls.deletes.length;
    releaseComparison({ similarity_score: 0.9 });
    await inFlight;
    assert.equal(io.events.length, 0);
    assert.equal(calls.deletes.length, deletesAfterCancel);
    assert.equal(scheduled.length, 1);
    assert.equal(service.getMetrics().timeouts, 0);
  });
});


test("profile lookup failure after a pair claim still reports an error", async () => {
  await fakeTimers(async ({ scheduled }) => {
    candidates = [{ userId: bobId, query: "candidate", created_at: new Date() }];
    userFindError = new Error("database unavailable");
    const io = makeIO();
    const service = createSearchService(io, { compare: async () => ({ similarity_score: 0.9 }) });
    await service.startSearch(aliceId, "query", { id: "socket-a" });
    const original = console.error;
    console.error = () => {};
    try { await scheduled[0].callback(); } finally { console.error = original; }
    assert.deepEqual(io.events, [{ room: `user:${aliceId}`, name: "error", payload: { message: "An error occurred while checking for matches." } }]);
    assert.deepEqual(calls.locks.filter(([filter]) => filter._id).map(([filter]) => filter), [
      { _id: aliceId, isLocked: true }, { _id: bobId, isLocked: true },
    ]);
  });
});

test("a failed profile lookup leaves the partner's local search running", async () => {
  await fakeTimers(async ({ scheduled, cleared }) => {
    candidates = [{ userId: bobId, query: "candidate", created_at: new Date() }];
    userFindError = new Error("database unavailable");
    const io = makeIO();
    const service = createSearchService(io, { compare: async () => ({ similarity_score: 0.9 }) });
    await service.startSearch(aliceId, "query", { id: "socket-a" });
    await service.startSearch(bobId, "query", { id: "socket-b" });
    const original = console.error;
    console.error = () => {};
    try { await scheduled[0].callback(); } finally { console.error = original; }
    assert.ok(!cleared.includes(scheduled[1].timer));
    assert.deepEqual(io.events.map(({ room }) => room), [`user:${aliceId}`]);
    assert.equal(io.events[0].name, "error");
    assert.equal(service.getMetrics().activeSearches, 1);
  });
});

test("timezone-aware searches compare UTC windows across calendar dates in both directions", async () => {
  for (const [self, other] of [
    [{ date: '2028-01-15', time: '20:00', timeZone: 'America/New_York', utcOffsetMinutes: -300 },
      { date: '2028-01-16', time: '09:00', timeZone: 'Asia/Singapore', utcOffsetMinutes: 480 }],
    [{ date: '2028-01-16', time: '09:00', timeZone: 'Asia/Singapore', utcOffsetMinutes: 480 },
      { date: '2028-01-15', time: '20:00', timeZone: 'America/New_York', utcOffsetMinutes: -300 }],
  ]) {
    await fakeTimers(async ({ scheduled }) => {
      calls.searches.length = 0;
      lockResults = [{ _id: aliceId }, { _id: bobId }];
      candidates = [{ userId: bobId, query: 'same activity', ...other,
        availabilityStart: new Date('2028-01-16T00:30:00Z'), availabilityEnd: new Date('2028-01-16T01:30:00Z'), created_at: new Date() }];
      const io = makeIO();
      let comparisons = 0;
      const service = createSearchService(io, { compare: async () => { comparisons++; return { similarity_score: 0.9 }; } });
      await service.startSearch(aliceId, 'same activity', { id: 'socket-a' }, self);
      await scheduled[0].callback();
      assert.equal(comparisons, 1);
      assert.equal(io.events.length, 2);
      assert.deepEqual(calls.searches[0][0].$or, [
        { availabilityStart: { $lte: new Date('2028-01-16T01:30:00Z') }, availabilityEnd: { $gte: new Date('2028-01-16T00:30:00Z') } },
        { availabilityStart: null, date: null, time: null },
      ]);
    });
  }
});

test("zoned and legacy constrained schedules are excluded symmetrically before scoring", async () => {
  const zoned = { date: '2028-01-15', time: '20:00', timeZone: 'America/New_York', utcOffsetMinutes: -300,
    availabilityStart: new Date('2028-01-16T00:30:00Z'), availabilityEnd: new Date('2028-01-16T01:30:00Z') };
  const legacy = { date: '2028-01-15', time: '20:00' };
  for (const [self, other] of [[zoned, legacy], [legacy, zoned]]) {
    await fakeTimers(async ({ scheduled }) => {
      candidates = [{ userId: bobId, query: 'same activity', ...other, created_at: new Date() }];
      let comparisons = 0;
      const service = createSearchService(makeIO(), { compare: async () => { comparisons++; return { similarity_score: 0.9 }; } });
      await service.startSearch(aliceId, 'same activity', { id: 'socket-a' }, self);
      await scheduled[0].callback();
      assert.equal(comparisons, 0);
    });
  }
});

test("a zoned search can match a text-only legacy search", async () => {
  await fakeTimers(async ({ scheduled }) => {
    candidates = [{ userId: bobId, query: 'same activity', date: null, time: null, created_at: new Date() }];
    let comparisons = 0;
    const service = createSearchService(makeIO(), { compare: async () => { comparisons++; return { similarity_score: 0.9 }; } });
    await service.startSearch(aliceId, 'same activity', { id: 'socket-a' }, { date: '2028-01-15', time: '20:00', timeZone: 'America/New_York', utcOffsetMinutes: -300 });
    await scheduled[0].callback();
    assert.equal(comparisons, 1);
  });
});
