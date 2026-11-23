# Local search load harness

This harness creates disposable users in a local Firebase Auth emulator and a
temporary MongoDB replica set. It sends the same chess query from every client
in one burst and observes events for 45 seconds. It is an exploratory workload,
not a production readiness or match-quality test. The server, database and
emulator must run on the same machine; fixed local ports are reserved.

Install development dependencies with `npm ci`. Python must have the backend's
similarity dependencies and a cached `paraphrase-mpnet-base-v2` model with a
Hugging Face `refs/main` entry. The first install of the MongoDB test binary can
require internet access. Use a supported Node release for Firebase Tools.

In three terminals, from the repository root:

1. `node scripts/load/start-local.js`. Leave it running and copy its printed
   temporary directory and marker path. It verifies a database transaction and
   an emulator sign-in. Stopping it removes the temporary database and accounts.
2. `node scripts/load/start-backend.js <temporary-directory>`. This uses a
   synthetic service account, localhost-only listener, the temporary database,
   and a copy of the worker pointed to the locally cached model revision. It
   does not read the project's `.env` or use its service account.
3. `node scripts/load/run-local.js 10 <marker-path> /tmp/clickmate-run.json`.
   The output path must not already exist. Even counts from 2 through 1000 are
   accepted. The script verifies the database marker, signs up unique users,
   opens all sockets before submitting, and deletes only its own user profiles.
   Stop and restart both services between runs to avoid unfinished matching work
   affecting later results. Test identities also disappear when the emulator
   stops.

`matches` counts users' first matching events; `duplicateEvents` counts further
search updates to the same user, including late timeout events. `unresolved`
counts users without a first search update within the observation window. The
latency samples start at the submission burst and include only first matching
events. Errors are counted separately. The harness does not yet measure CPU,
peak memory, throughput over the full process lifecycle, pair uniqueness,
reconnections, or failure recovery. It does not prove that 1000 users are safe.
Use the report format in `load-baseline-report.md` after collecting the missing
resource measurements. Avoid large bursts on a shared machine until resource
limits and backpressure are in place.

## Exploratory results, 23 November 2026

On a MacBook Air with Apple M1 and 16 GiB RAM, Node 25.1.0, Python 3.11.9,
local MongoDB 8.2.6, the cached model, and the temporary authentication
emulator, two ten-user bursts produced ten first match events and five extra
search updates each. The first run's match latency p50 was 4,991 ms and p95
was 6,019 ms. A 100-user burst produced no first result within 45 seconds;
all 100 were unresolved. These runs used the same workload as above but did
not collect CPU or peak memory, and are not the complete M03 baseline. The
1000-user burst was not run: the 100-user result exposed an unbounded workload
and the current harness has no resource guard. M04 will address stale work;
search throughput remains a later roadmap item.
