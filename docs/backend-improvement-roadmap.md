# ClickMate backend improvement roadmap

This is the progress tracker for the daily 7:00 a.m. Europe/Dublin micro-PR
task. It covers the matching improvements discussed on 15 November 2026 and
the remaining reliability work in
[`backend-audit-2026-11-15.md`](backend-audit-2026-11-15.md).

## How to use this tracker

- One smallest complete task gets one descriptive branch and one reviewable PR.
- Finish or unblock an open PR before starting a dependent task.
- Update this file in each PR: mark only merged work complete, link the PR,
  record exact test results, and name the next task.
- If an item is too large for one PR, split it into numbered subitems here
  before coding. Keep its acceptance condition.
- Never mark a task complete because code exists only on an unmerged branch.

**Current:** M02.2 — worker metrics and a combined test report (pending PR merge).
**Next after M02.2:** M03 — repeatable baseline.
**Blocked:** none.

M01's [search contract](search-contract.md) describes the target guarantees
and identifies current gaps.

## Sprint 1 — Contract and baseline

- [x] **M01 Search contract and invariants.** Document request/result fields,
  one active search per user, cancellation, replacement, timeout, match
  semantics, and activity date versus profile birthdate. Set the initial
  release targets below. **Done when:** the contract covers concurrent and
  reconnecting clients.
- [ ] **M02 Search metrics.** Measure active searches, candidate counts,
  comparisons and embeddings, queue depth, match latency, cancellations,
  timeouts, worker failures, and failed pair claims. Keep query text out of
  metrics. **Done when:** a test run can report these values.
  - [x] **M02.1 Search observations:** process-local active search, candidate,
    comparison, cancellation, timeout, claim failure, and match latency metrics.
  - [ ] **M02.2 Worker observations and report:** count embeddings and worker
    failures, measure queue depth, and produce a combined test-run report.
- [ ] **M03 Repeatable baseline.** Add a test-only load harness for 10, 100,
  and 1,000 connected searchers, including simultaneous submissions. Record
  hardware, database tier, p50/p95 latency, throughput, CPU, and memory.
  **Done when:** another developer can reproduce the baseline.

## Sprint 2 — Search correctness

- [ ] **M04 Stop stale work.** Stop both users' search timers or jobs after a
  match. Test concurrent loops, timeout, cancellation, and replacement.
  **Done when:** a matched search cannot emit another result or timeout.
- [ ] **M05 Search identity.** Give each search attempt a unique ID or
  generation. **Done when:** stale work cannot delete, unlock, or notify for a
  newer attempt.
- [ ] **M06 Explicit states.** Model waiting, claiming or matched, cancelled,
  and expired with conditional transitions. Define which outcome wins when
  cancellation races with matching. **Done when:** every transition is
  idempotent and expiry does not depend on immediate TTL deletion.
- [ ] **M07 Atomic pair commit.** Claim both current searches and persist the
  pair in one transaction or an equivalently proven atomic design.
  **Done when:** concurrent workers cannot commit a user to two pairs; verify
  against a test replica set where available.
- [ ] **M08 Durable result delivery.** Persist result IDs and let reconnecting
  clients resynchronize. Emit only after commit, deduplicate results, and
  leave the socket available for chat. **Done when:** a missed socket event
  does not lose the match.

## Sprint 3 — Match quality with few inputs

- [x] **M09a Optional date and time picker values.** Accept and store separate
  calendar date and time values alongside text, validate them, and use both
  when filtering candidates while keeping text-only clients compatible.
- [ ] **M09b Timezone-aware availability.** Add a timezone and time window or
  flexibility, store an unambiguous UTC interval, and keep old clients
  compatible during rollout. **Done when:** time overlap works across
  timezones.
- [ ] **M10 Activity mode.** Support online or nearby mode and location only
  where the activity needs it. **Done when:** in-person and online requests
  are filtered correctly without making the form heavy.
- [ ] **M11 Optional age preference.** Use profile birthdate only when
  available; make any preferred range optional and mutual. **Done when:**
  incompatible explicit preferences are rejected symmetrically.
- [ ] **M12 Hard compatibility filter.** Exclude self, blocked, expired, or
  claimed searches and incompatible time, mode, location, or preferences
  before semantic scoring. **Done when:** excluded pairs never reach ranking.
- [ ] **M13 Scoring and ties.** Isolate text similarity, time overlap,
  threshold, wait-time fairness, and deterministic final tie breaks.
  **Done when:** the same batch always yields the same eligible ranking.
- [ ] **M14 Quality evaluation.** Add labelled paraphrases, near misses,
  incompatible pairs, and similar-score cases. Calibrate weights and
  threshold instead of assuming the current 0.5 value is optimal.
  **Done when:** acceptable-match and false-positive rates are reported.

## Sprint 4 — Speed and pair selection

- [ ] **M15 Encode once.** Compute and reuse one embedding per active query,
  including model-version handling. **Done when:** candidate comparisons do
  not re-encode both users' text.
- [ ] **M16 Bounded shortlist.** Filter structured fields and retrieve top-K
  semantic candidates. Compare shortlist recall with exhaustive comparison;
  choose in-memory or vector-index retrieval from the measurement.
  **Done when:** candidate work is bounded and quality stays acceptable.
- [ ] **M17 Bounded inference.** Batch embedding requests when useful, limit
  queue size and concurrency, handle backpressure and worker restarts.
  **Done when:** overload has a clear, tested outcome rather than unbounded
  waiting.
- [ ] **M18 Batch pairing.** Rank eligible edges across a brief matching
  window, improve total compatibility over per-user greedy matching, and
  apply wait-time tie breaks. **Done when:** quality and latency are measured
  against the simpler baseline.

## Sprint 5 — Multiple instances and recovery

- [ ] **M19 Distributed search ownership.** Use a lease or equivalent
  coordination so instances do not run stale jobs; recover abandoned work.
  **Done when:** a worker or server restart cannot strand a waiting search.
- [ ] **M20 Multi-instance exercise.** Test match, cancel, replacement,
  reconnect, worker failure, and server restart across two instances with
  test-only MongoDB and Socket.IO infrastructure. **Done when:** outcomes are
  consistent whichever instance handles either user.

## Sprint 6 — Broader data reliability

- [ ] **M21 Atomic chat creation.** Prevent friend lists and chat records from
  diverging after partial failure or concurrent requests.
- [ ] **M22 Recoverable account deletion.** Define and test a retryable
  workflow for partial Firebase and MongoDB deletion.
- [ ] **M23 Service integration tests.** Exercise real test MongoDB indexes
  and transactions, concurrent chat creation, and avatar storage lifecycle.
- [ ] **M24 Dependency follow-up.** Resolve or document the remaining
  production advisories with tested updates.
- [ ] **M25 Avatar migration decision.** Choose and verify a retention or
  migration path for the two active avatar storage flows. Split implementation
  into separate micro PRs if needed.

## Sprint 7 — Release and operations

- [ ] **M26 Readiness and alerts.** Make readiness reflect MongoDB and
  similarity-worker health; monitor error rate, queue depth, latency, rate
  limits, and process restarts.
- [ ] **M27 Load and failure gate.** Sustain 1,000 connected searchers and
  test simultaneous submission bursts on documented infrastructure. Verify
  zero duplicate or stale matches, no matched users left waiting, recovery
  after reconnect or restart, and latency with resource headroom.
- [ ] **M28 Release review.** Validate the full app flow, authorization and
  rate limits across instances, deployment, rollback, and final acceptance
  checks before closing this roadmap.

## Initial targets for Sprint 1 to validate

- Support 1,000 connected searchers and a simultaneous submission burst on
  documented infrastructure.
- Observe zero duplicate committed pairs and zero stale match or timeout
  events after cancellation or replacement in stress tests.
- Start with a p95 decision target of two seconds when a compatible partner
  is already available. Exclude no-partner waits and revise the target only
  with a documented product and performance tradeoff.
- Evaluate match quality with human-labelled examples.
- State exact test commands and results in each PR. Identify skipped or
  environment-blocked checks rather than claiming they passed.

## Daily progress log

| Date (Dublin) | Task | Branch | PR / merge | Tests and result | Blocker / next |
| --- | --- | --- | --- | --- | --- |
| 2026-11-15 | R00 | `docs/backend-improvement-roadmap` | [PR #27](https://github.com/Subhom1/clickmate-backend/pull/27) merged as `e223221` | GitHub backend regression and coverage check passed | M01 |
| 2026-11-15 | M09a | `feature/search-date-time` | [PR #28](https://github.com/Subhom1/clickmate-backend/pull/28), merged `d653d17099a15d78fb0cc8718fe939692d6b8c75` | 46 focused tests passed; `npm test` passed (195 tests and syntax); `git diff --check` passed | M01 |
| 2026-11-16 | M01 | `docs/search-contract-m01` | [PR #29](https://github.com/Subhom1/clickmate-backend/pull/29), merged `5792441f17b8c7b09794052718bfc7467933af36` | `git diff --check`: passed; GitHub backend regression and coverage check passed | M02 |
| 2026-11-17 | M02.1 | `feat/search-metrics-m02-1` | [PR #30](https://github.com/Subhom1/clickmate-backend/pull/30) merged `b1cdc23dbbc122f9cc98573d072a1db6e7532ba8` | `node --experimental-test-module-mocks --test tests/unit/services/searchService.test.js`: 11 passed; `npm test`: 197 passed and syntax check passed with loopback access | M02.2 |

| 2026-11-18 | M02.2 | `feat/worker-metrics-m02-2` | PR pending | Focused service and worker tests: 27 passed; `npm test`: 201 passed and syntax checks passed with loopback access; `git diff --check`: passed | Await PR merge; next M03 |

## Decision log

Record changes to scope, scoring policy, thresholds, and performance targets
here with a PR or discussion link. Do not silently drop a roadmap item.

- **2026-11-15, M09a:** The existing Home UI makes date and time independently
  optional. An omitted value therefore leaves that dimension unrestricted.
  When both users provide dates, they must match; when both provide times,
  their local clock values must be within 60 minutes. Timezone-aware windows
  remain in M09b.
- **2026-11-17, M02:** Split search observations from worker observations and
  the combined report. M02 remains incomplete until both slices merge.
