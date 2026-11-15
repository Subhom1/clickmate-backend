# Backend audit — 15 November 2026

## Scope and method

Reviewed the Express routes, middleware, Socket.IO handlers, MongoDB models, media services, Python worker, configuration, scripts, and unit tests. Ran the full test and syntax suite, source coverage, and a production dependency audit. This is a code and test audit; it does not replace a live test against MongoDB, Firebase, S3, or a deployed frontend.

## Fixed in this change

| Area | Finding | Change |
| --- | --- | --- |
| Explore uploads | Early validation responses left files saved by Multer. A missing category could be created by an `upsert`, and database errors returned HTTP 400. | Moved item parsing into one small function, cleaned files after every failed request, removed the `upsert`, enabled schema validation, and returned 404 or 500 where appropriate. |
| Identity lookup | HTTP and socket email fallback could accept a profile linked to a different Firebase UID. | UID lookup now takes precedence, and a conflicting linked profile is rejected. The user lookup route also checks the UID. |
| Registration | A database exception was returned to the client verbatim. | Return a stable generic error and log the detail on the server. |
| Similarity worker | An exit before readiness with code 0 left startup pending. Later comparisons could still be accepted after exit. A failed pipe write left a pending request. | Centralized worker failure handling, cleared pending work, stopped accepting comparisons after exit, and cleaned up failed writes. |
| Dependencies | The initial production audit reported 3 high, 8 moderate, and 1 low advisory. | Updated `sharp` to 0.35.5 and refreshed compatible lockfile packages. The follow-up production audit reports **0 high, 0 critical, and 7 moderate** advisories. |
| Dead code | `scripts/calculate_similarity.py` repeated the active worker's model loading and was not referenced by runtime code or tests. | Removed the unused script. |

## Next work, in priority order

1. **Make chat creation atomic.** `routes/chatRoutes.js` updates both users' friend lists before saving the chat. A failed save can leave friendship state without a conversation. Put the related writes in a MongoDB transaction, or save the chat first and use an explicit compensating path. Test concurrent create requests and failure at each write.
2. **Make account deletion recoverable.** `routes/userRoutes.js` deletes the Firebase identity before the MongoDB profile. If MongoDB deletion fails, the remaining profile cannot be reached with its old identity. Define a retryable deletion workflow and cover partial failure.
3. **Coordinate searches across instances.** `services/searchService.js` keeps timers and cancellations in a process-local map. The MongoDB Socket.IO adapter shares events, but not that map. Define search ownership and a lease or job mechanism before scaling to multiple instances. Test disconnect and cancellation while a match is being locked.
4. **Finish dependency remediation.** The remaining seven moderate production advisories are in transitive packages including `gaxios`, `glob`, `minimatch`, and `uuid`. Review upstream fixes and update the Firebase dependency chain in a separate, tested dependency change. Keep `npm audit --omit=dev` in the release check.
5. **Add service integration coverage.** Most tests use mocked MongoDB, Firebase, and Socket.IO. Add a dedicated test environment for actual MongoDB indexes, concurrent chat creation, and avatar storage lifecycle. The current full-source report is useful for unit coverage, but it cannot prove cross-service behavior.
6. **Consolidate old and new avatar paths.** The S3 media asset flow and MongoDB avatar file flow both remain active, with separate profile pointers (`avatarMediaId` and `avatarFileId`). Choose a migration and retention policy before deleting either path, so old avatar URLs and profiles keep working.

## Verification

```bash
npm ci
npm test
npm run test:coverage
npm audit --omit=dev
git diff --check
```

The tests use mocked external services by default. A live end-to-end exercise needs test-only credentials and infrastructure; no production data should be used.
