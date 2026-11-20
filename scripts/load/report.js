import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// Nearest-rank percentiles; unmatched searches have no decision latency.
export function summarizeRun(run) {
  const positive = (value) => Number.isFinite(value) && value > 0;
  const nonnegative = (value) => Number.isFinite(value) && value >= 0;
  if (!run || typeof run !== 'object' || !Number.isInteger(run.connectedSearchers) ||
      !positive(run.connectedSearchers) || !positive(run.durationSeconds) ||
      !nonnegative(run.cpuSeconds) || !nonnegative(run.peakMemoryBytes) ||
      !Array.isArray(run.decisionLatencyMs) || !run.decisionLatencyMs.every(nonnegative) ||
      run.decisionLatencyMs.length > run.connectedSearchers ||
      typeof run.hardware !== 'string' || !run.hardware.trim() ||
      typeof run.databaseTier !== 'string' || !run.databaseTier.trim()) {
    throw new Error('Invalid run: provide hardware, databaseTier, connectedSearchers, durationSeconds, cpuSeconds, peakMemoryBytes and nonnegative decisionLatencyMs');
  }
  const samples = [...run.decisionLatencyMs].sort((a, b) => a - b);
  const percentile = (p) => samples.length ? samples[Math.ceil(p * samples.length) - 1] : null;
  return {
    hardware: run.hardware,
    databaseTier: run.databaseTier,
    connectedSearchers: run.connectedSearchers,
    durationSeconds: run.durationSeconds,
    decisions: samples.length,
    p50DecisionMs: percentile(0.5),
    p95DecisionMs: percentile(0.95),
    decisionsPerSecond: samples.length / run.durationSeconds,
    cpuSeconds: run.cpuSeconds,
    peakMemoryBytes: run.peakMemoryBytes,
  };
}

async function main() {
  if (process.argv.length !== 3) throw new Error('Usage: node scripts/load/report.js <run.json>');
  const run = JSON.parse(await readFile(process.argv[2], 'utf8'));
  console.log(JSON.stringify(summarizeRun(run), null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
