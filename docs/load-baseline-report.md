# Load baseline report

The M03.1 report summarizes measurements collected by a test run; it does not
start a server, generate load, or measure resource use. Never use production
credentials or customer data for a baseline. The M03 load harness and actual
baseline remain outstanding.

Save an isolated run as JSON with these fields:

```json
{
  "hardware": "describe CPU and RAM",
  "databaseTier": "describe test database and location",
  "connectedSearchers": 10,
  "durationSeconds": 30,
  "cpuSeconds": 12.5,
  "peakMemoryBytes": 104857600,
  "decisionLatencyMs": [250, 300]
}
```

Run `node scripts/load/report.js path/to/run.json`. Record separately how CPU
seconds and peak memory were measured and which processes they include. Each
latency is milliseconds from submission to a completed match decision for one
searcher; do not insert a zero for a search that has not reached a decision.
The report uses nearest-rank p50 and p95, with null for an empty sample, and
counts decisions per second over the full run duration. These are descriptive
statistics, not evidence that a performance target has passed. Keep the raw
run and its workload description with any published baseline so it can be
reproduced.
