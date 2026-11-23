import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import User from '../../models/UserDetailSchema.js';
import Search from '../../models/UserSearchSchema.js';
import { createSearchService } from '../../services/searchService.js';

const enabled = process.env.RUN_MONGODB_INTEGRATION === '1';

test('real MongoDB matches equivalent instants across calendar dates in both directions', { skip: !enabled }, async () => {
  const replica = await MongoMemoryReplSet.create({ replSet: { count: 1, ip: '127.0.0.1' } });
  try {
    await mongoose.connect(replica.getUri('clickmate_timezone_test'));
    await Search.init();
    const a = await User.create({ fullname: 'A', email: 'a@example.test' });
    const b = await User.create({ fullname: 'B', email: 'b@example.test' });
    const ny = { date: '2028-01-15', time: '20:00', timeZone: 'America/New_York', utcOffsetMinutes: -300 };
    const sg = { date: '2028-01-16', time: '09:00', timeZone: 'Asia/Singapore', utcOffsetMinutes: 480 };
    for (const [self, other] of [[ny, sg], [sg, ny]]) {
      await Search.deleteMany({});
      await Search.create({ userId: b._id, query: 'chess', ...other,
        availabilityStart: new Date('2028-01-16T00:30:00Z'), availabilityEnd: new Date('2028-01-16T01:30:00Z') });
      const events = [];
      const io = { to: room => ({ emit: (event, payload) => events.push({ room, event, payload }) }) };
      const service = createSearchService(io, { compare: async () => ({ similarity_score: 0.9 }) });
      await service.startSearch(String(a._id), 'chess', { id: 'a' }, self);
      for (let i = 0; i < 50 && events.length < 2; i++) await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal(events.filter((event) => event.payload?.matches).length, 2);
      assert.equal(new Set(events.map((event) => event.room)).size, 2);
      await service.cleanupSocketSearches('a');
    }
    const utcWindow = { availabilityStart: new Date('2028-01-16T00:30:00Z'), availabilityEnd: new Date('2028-01-16T01:30:00Z') };
    const cases = [
      { self: ny, other: {}, matches: true, label: 'zoned to old text-only record' },
      { self: {}, other: { ...sg, ...utcWindow }, matches: true, label: 'text-only to zoned record' },
      { self: ny, other: { date: ny.date }, matches: false, label: 'zoned to legacy date-only' },
      { self: ny, other: { time: ny.time }, matches: false, label: 'zoned to legacy time-only' },
      { self: { date: ny.date }, other: { ...sg, ...utcWindow }, matches: false, label: 'legacy date-only to zoned' },
      { self: { time: ny.time }, other: { ...sg, ...utcWindow }, matches: false, label: 'legacy time-only to zoned' },
      { self: ny, other: { ...sg, availabilityStart: new Date('2028-01-16T01:31:00Z'), availabilityEnd: new Date('2028-01-16T02:31:00Z') }, matches: false, label: 'nonoverlapping zoned windows' },
      { self: sg, other: { ...ny, availabilityStart: new Date('2028-01-15T23:29:00Z'), availabilityEnd: new Date('2028-01-16T00:29:00Z') }, matches: false, label: 'nonoverlapping windows in reverse' },
    ];
    for (const item of cases) {
      await Search.deleteMany({});
      // Insert directly so missing legacy fields remain absent, as in older records.
      await Search.collection.insertOne({ userId: b._id, query: 'chess', isLocked: false, created_at: new Date(), ...item.other });
      const events = [];
      let comparisons = 0;
      const io = { to: room => ({ emit: (event, payload) => events.push({ room, event, payload }) }) };
      const service = createSearchService(io, { compare: async () => { comparisons++; return { similarity_score: 0.9 }; } });
      const originalFind = Search.find;
      let finishQuery;
      const queryFinished = new Promise((resolve) => { finishQuery = resolve; });
      Search.find = function (...args) {
        const query = originalFind.apply(this, args);
        const originalLean = query.lean;
        query.lean = async function (...leanArgs) {
          try { return await originalLean.apply(this, leanArgs); }
          finally { finishQuery(); }
        };
        return query;
      };
      let deadline;
      try {
        await service.startSearch(String(a._id), 'chess', { id: 'a' }, item.self);
        await Promise.race([queryFinished, new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('Candidate query did not finish')), 5000); })]);
        await new Promise((resolve) => setImmediate(resolve));
        if (item.matches) for (let i = 0; i < 20 && events.length < 2; i++) await new Promise((resolve) => setTimeout(resolve, 50));
        assert.equal(comparisons, item.matches ? 1 : 0, item.label);
        assert.equal(events.filter((event) => event.event === 'error').length, 0, item.label);
        assert.equal(events.filter((event) => event.payload?.matches).length, item.matches ? 2 : 0, item.label);
      } finally {
        clearTimeout(deadline);
        Search.find = originalFind;
        await service.cleanupSocketSearches('a');
      }
    }
  } finally {
    await mongoose.disconnect();
    await replica.stop();
  }
});
