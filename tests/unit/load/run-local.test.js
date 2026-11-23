import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseCount, runLocal } from '../../../scripts/load/run-local.js';

test('load harness accepts only even counts between two and one thousand', () => {
  assert.equal(parseCount('10'), 10);
  for (const input of ['0', '1', '3', '1002', '1.5', 'foo']) assert.throws(() => parseCount(input));
});

test('load harness refuses a marker for any other database before connecting', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'clickmate-load-'));
  try {
    const file = path.join(dir, 'marker.json');
    await writeFile(file, JSON.stringify({ uri: 'mongodb://example.com/production', marker: 'bad' }));
    await assert.rejects(runLocal(2, file, path.join(dir, 'output.json')), /Expected local test setup marker/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
