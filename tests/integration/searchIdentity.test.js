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

test('delayed cleanup cannot delete or unlock a newer local attempt in MongoDB', { skip: !enabled }, async () => {
  const replica = await MongoMemoryReplSet.create({ replSet: { count: 1, ip: '127.0.0.1' } });
  const originalDelete = Search.deleteOne;
  let service, id, pendingCleanup, releaseDelete;
  try {
    await mongoose.connect(replica.getUri('clickmate_cleanup_test'));
    await Search.init();
    id = new mongoose.Types.ObjectId().toString();
    service = createSearchService({ to: () => ({ emit() {} }) }, { compare: async () => ({ similarity_score: 0 }) });
    await service.startSearch(id, 'old', { id: 'old-socket' });
    const old = await Search.findOne({ userId: id }).lean();
    let markDeleteStarted;
    const deleteStarted = new Promise((resolve) => { markDeleteStarted = resolve; });
    const gate = new Promise((resolve) => { releaseDelete = resolve; });
    let first = true;
    Search.deleteOne = function (...args) {
      if (first) {
        first = false;
        markDeleteStarted();
        return gate.then(() => originalDelete.apply(this, args));
      }
      return originalDelete.apply(this, args);
    };
    pendingCleanup = service.cleanupSearch(id);
    await deleteStarted;
    await service.startSearch(id, 'new', { id: 'new-socket' });
    const next = await Search.findOne({ userId: id }).lean();
    assert.notEqual(next.searchId, old.searchId);
    await Search.updateOne({ userId: id, searchId: next.searchId }, { $set: { isLocked: true } });
    releaseDelete();
    await pendingCleanup;
    const after = await Search.findOne({ userId: id }).lean();
    assert.equal(after?.searchId, next.searchId);
    assert.equal(after?.isLocked, true);
    assert.equal(service.getMetrics().activeSearches, 1);
    await service.cleanupSocketSearches('new-socket');
    assert.equal(await Search.countDocuments({ userId: id }), 0);
    assert.equal(service.getMetrics().activeSearches, 0);
  } finally {
    releaseDelete?.();
    if (pendingCleanup) await pendingCleanup.catch(() => {});
    Search.deleteOne = originalDelete;
    try { if (service && id) await service.cleanupSocketSearches('new-socket'); }
    finally { await mongoose.disconnect(); await replica.stop(); }
  }
});

test('a delayed timeout cannot expire or notify for a replacement in MongoDB', { skip: !enabled, timeout: 45000 }, async () => {
  const replica = await MongoMemoryReplSet.create({ replSet: { count: 1, ip: '127.0.0.1' } });
  const originalDelete = Search.deleteOne;
  let service, id, release, pendingExpiry;
  try {
    await mongoose.connect(replica.getUri('clickmate_timeout_test'));
    await Search.init();
    id = new mongoose.Types.ObjectId().toString();
    const events = [];
    service = createSearchService({ to: room => ({ emit: (event, payload) => events.push({ room, event, payload }) }) }, { compare: async () => ({ similarity_score: 0 }) });
    await service.startSearch(id, 'old', { id: 'old-socket' });
    const old = await Search.findOne({ userId: id }).lean();
    let notifyExpiry;
    const started = new Promise((resolve) => { notifyExpiry = resolve; });
    const gate = new Promise((resolve) => { release = resolve; });
    Search.deleteOne = function (filter, ...args) {
      if (filter.searchId === old.searchId && filter.isLocked) {
        pendingExpiry = gate.then(() => originalDelete.call(this, filter, ...args));
        notifyExpiry();
        return pendingExpiry;
      }
      return originalDelete.call(this, filter, ...args);
    };
    let deadline;
    try { await Promise.race([started, new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('Timeout deletion did not begin')), 40000); })]); }
    finally { clearTimeout(deadline); }
    await service.startSearch(id, 'new', { id: 'new-socket' });
    const next = await Search.findOne({ userId: id }).lean();
    assert.notEqual(next.searchId, old.searchId);
    await Search.updateOne({ userId: id, searchId: next.searchId }, { $set: { isLocked: true } });
    release();
    await pendingExpiry;
    await new Promise((resolve) => setImmediate(resolve));
    const after = await Search.findOne({ userId: id }).lean();
    assert.equal(after?.searchId, next.searchId);
    assert.equal(after?.isLocked, true);
    assert.equal(events.length, 0);
    assert.equal(service.getMetrics().activeSearches, 1);
    await service.cleanupSocketSearches('new-socket');
  } finally {
    release?.();
    if (pendingExpiry) await pendingExpiry.catch(() => {});
    Search.deleteOne = originalDelete;
    try { if (service && id) await service.cleanupSocketSearches('new-socket'); }
    finally { await mongoose.disconnect(); await replica.stop(); }
  }
});
