import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import Search from '../../models/UserSearchSchema.js';
import { createSearchService } from '../../services/searchService.js';

const enabled = process.env.RUN_MONGODB_INTEGRATION === '1';

test('sequential search attempts persist distinct identities in MongoDB', { skip: !enabled }, async () => {
  const replica = await MongoMemoryReplSet.create({ replSet: { count: 1, ip: '127.0.0.1' } });
  let service, id;
  try {
    await mongoose.connect(replica.getUri('clickmate_identity_test'));
    await Search.init();
    id = new mongoose.Types.ObjectId().toString();
    service = createSearchService({ to: () => ({ emit() {} }) }, { compare: async () => ({ similarity_score: 0 }) });
    await service.startSearch(id, 'first', { id: 'socket-a' });
    const first = await Search.findOne({ userId: id }).lean();
    await service.startSearch(id, 'second', { id: 'socket-a' });
    const second = await Search.findOne({ userId: id }).lean();
    assert.match(first.searchId, /^[0-9a-f-]{36}$/);
    assert.match(second.searchId, /^[0-9a-f-]{36}$/);
    assert.notEqual(first.searchId, second.searchId);
    assert.equal(second.query, 'second');
  } finally {
    try { if (service && id) await service.cleanupSearch(id); }
    finally { await mongoose.disconnect(); await replica.stop(); }
  }
});
