# Search contract and release invariants

This is the target contract for the roadmap, not a claim that the current
implementation already meets it. M04–M08 implement the lifecycle guarantees.

## Process-local search observations

`createSearchService(...).getMetrics()` returns aggregate observations for a
test harness: current in-memory active searches, candidate documents returned,
uncached comparison attempts, stopped searches (explicit cancellation,
replacement, or disconnect), timeouts, failed pair claims, matches, and total
and maximum initiating-search match latency in milliseconds. Counts reset on
restart and are not shared across instances. They describe the current
process-local lifecycle, including its known races, and are not durable counts
of users or committed matches. No query text or user IDs are included.
`searchService.getMetricsReport()` combines this snapshot with the similarity
service's `getMetrics()` snapshot for test runs. Worker `pending` counts all
outstanding requests (both executing and waiting for Python), while `maxPending`
is its process-lifetime high-water mark, not the Python queue length. `embeddings`
counts outputs from completed model encode calls reported by the worker, including
late responses; results lost when the worker exits are unobservable. Worker
`workerFailures` counts unexpected process failures once per worker start,
excluding intentional shutdown. Metrics reset on process restart and are not
aggregated across instances. A test harness can report them with:

```js
console.log(JSON.stringify(searchService.getMetricsReport(), null, 2));
```

## Request and result

An authenticated socket submits `submit_keyword` with its own `userId`, a
nonempty `query` (at most 500 characters after whitespace normalization), and
optional `date` (`YYYY-MM-DD`) and `time` (`HH:mm`). Missing schedule fields
are unrestricted. Legacy clients that omit zone information use the existing
rule: two supplied dates must agree and two supplied times must be within 60
minutes. Clients can additionally submit `timeZone` (an IANA zone) and
`utcOffsetMinutes` (integer minutes east of UTC) when both date and time are
present. The offset must be valid for that zone and local date/time; it selects
an occurrence when a clock time repeats during a daylight-saving transition.
Nonexistent local times, incomplete zone information and mismatched offsets are
rejected. Each accepted zoned time becomes a UTC interval from 30 minutes
before to 30 minutes after the selected instant; zoned intervals match when
they overlap, including a touching boundary. This preserves the previous
60-minute tolerance while allowing matches across time zones and dates.

A legacy text-only search can match either kind of search. A legacy search
that provides date or time cannot match a zoned search, because its time zone
is unknown; two legacy searches retain their existing rules. These are activity
preferences, never profile birthdates. All backend instances must understand
these fields before clients send them. Interval-query performance and indexing
have not been established at load. Invalid requests produce an `error` event
and do not start a search.

Today `search_update` reports either `matches` containing the other user's
profile and a similarity score, or `matches: null` when no result is found.
The target durable result also needs a stable match ID and search IDs, so a
client can deduplicate delivery and reconcile after a missed event (M05, M08).
The exact wire format and migration for these additions are deferred to those
tasks; clients must not assume they exist yet.

## Search identity foundation

New searches are assigned a server-generated UUID that is stored in the search
record and its local process entry. Existing records may lack an ID, and older
backend instances can continue to create them during a mixed-version rollout;
an older writer may also retain an ID on a different attempt. Concurrent new
writers can leave a local ID out of sync with the persisted record. Locally
tracked cleanup now deletes only the captured attempt ID and removes the local
entry only if it still refers to that attempt. IDs are not yet sent to clients.
Cleanup no longer performs a user-only unlock after deleting a record. Cleanup
without a local ID still uses a user-only fallback. Local timeout work now
deletes only the captured, unlocked attempt before sending a timeout. A locked
attempt retries expiration without restarting candidate comparisons; a missing
or locally replaced attempt stops without a timeout. The search error path
unlocks only its captured ID. A permanently locked record can keep retrying,
and a database failure during expiry can leave a searchable record after the
local timer stops. Locks acquired by other workers, replacement, and match
notifications are not fully guarded by attempt identity. A remote replacement
can occur between deletion and the room event, which has no attempt ID; an
older mixed-version writer may reuse an ID. This does not establish ordering
or prevent stale work across instances. M05 and the lifecycle guarantees below
remain incomplete.

## Lifecycle guarantees to implement

- Each user has at most one current search across sockets and instances. Each
  accepted attempt has a unique ID and a waiting, matched, cancelled, or expired
  outcome. Repeated requests for the same transition are idempotent.
- A replacement retires the previous attempt before the new attempt becomes
  current. Work belonging to an old ID cannot delete, unlock, or notify for
  the new one. Concurrent submissions must have a defined serialization order.
- Cancellation targets an attempt and succeeds only while it is waiting. A
  match and cancellation race through conditional transitions: whichever
  commits first wins; the loser observes the committed outcome. A committed
  match is not undone by a later cancellation.
- Expiry is a conditional transition, not a consequence of TTL deletion. A
  cancelled, replaced, matched, or expired attempt cannot emit a later timeout
  or match. Both search jobs stop after a pair commits; the sockets remain
  available for chat.
- A match commits both current waiting attempts and one durable match record
  atomically. Concurrent workers cannot commit either user to another pair.
  Notifications occur after commit and can be delivered more than once, so
  clients deduplicate by match ID.
- A reconnecting authenticated client can fetch its current attempt and any
  committed result using stable IDs, even if it missed an event. Multiple
  connections for one user observe the same state; disconnecting one must not
  cancel another connection's current attempt. Authorization applies to all
  resynchronization and cancellation operations.

The existing process-local timers, user-keyed cleanup and sequential locks do
not establish these guarantees. Disconnect currently cleans up searches owned
by that socket, and match results are not durable. M04–M08 and M19–M20 address
these limitations; until then clients must not rely on the target guarantees.

## Initial release measures

The roadmap's Sprint 1 targets are the initial release criteria: 1,000
connected searchers including a simultaneous burst, zero duplicate committed
pairs and stale events in stress tests, and p95 decision time under two seconds
when a compatible partner is already available. Record the infrastructure and
exclude no-partner waits. Human-labelled examples must assess match quality.
These are targets to validate, not measured results.
