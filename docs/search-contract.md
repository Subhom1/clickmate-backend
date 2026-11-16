# Search contract and release invariants

This is the target contract for the roadmap, not a claim that the current
implementation already meets it. M04–M08 implement the lifecycle guarantees.

## Request and result

An authenticated socket submits `submit_keyword` with its own `userId`, a
nonempty `query` (at most 500 characters after whitespace normalization), and
optional `date` (`YYYY-MM-DD`) and `time` (`HH:mm`). Missing schedule fields
are unrestricted. Today, two supplied dates must agree and two supplied times
must be within 60 minutes. These are activity preferences, never profile
birthdates; timezone-aware intervals are deferred to M09b. Invalid requests
produce an `error` event and do not start a search.

Today `search_update` reports either `matches` containing the other user's
profile and a similarity score, or `matches: null` when no result is found.
The target durable result also needs a stable match ID and search IDs, so a
client can deduplicate delivery and reconcile after a missed event (M05, M08).
The exact wire format and migration for these additions are deferred to those
tasks; clients must not assume they exist yet.

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
