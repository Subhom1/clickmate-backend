import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeRun } from '../../../scripts/load/report.js';

const run = () => ({ hardware: 'test host', databaseTier: 'isolated local', connectedSearchers: 5,
  durationSeconds: 2, cpuSeconds: 1.5, peakMemoryBytes: 1024, decisionLatencyMs: [50, 10, 40, 20] });

test('summarizes completed decisions using nearest-rank percentiles without mutating samples', () => {
  const input = run();
  const result = summarizeRun(input);
  assert.equal(result.p50DecisionMs, 20);
  assert.equal(result.p95DecisionMs, 50);
  assert.equal(result.decisionsPerSecond, 2);
  assert.equal(result.decisions, 4);
  assert.deepEqual(input.decisionLatencyMs, [50, 10, 40, 20]);
});

test('reports missing percentiles when no searches reached a decision', () => {
  const result = summarizeRun({ ...run(), decisionLatencyMs: [] });
  assert.equal(result.p50DecisionMs, null);
  assert.equal(result.p95DecisionMs, null);
  assert.equal(result.decisionsPerSecond, 0);
});

test('rejects invalid or incomplete measurements', () => {
  for (const changes of [{ durationSeconds: 0 }, { cpuSeconds: -1 }, { peakMemoryBytes: null },
    { hardware: ' ' }, { decisionLatencyMs: [NaN] }, { connectedSearchers: 1 }]) {
    assert.throws(() => summarizeRun({ ...run(), ...changes }), /Invalid run/);
  }
});
