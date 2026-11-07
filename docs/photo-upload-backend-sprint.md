# Profile photo backend sprint

## Progress

- [x] 1. Architecture, models and storage adapter
- [ ] 2. Authenticated upload sessions
- [ ] 3. Byte verification and image validation
- [ ] 4. Profile persistence and safe replacement
- [ ] 5. Retrieval, removal and cleanup
- [ ] 6. Security and reliability
- [ ] 7. Integration and staging readiness

## Foundation and deployment prerequisites

The existing `user` collection stores an optional `avatarMediaId`; `media_assets` stores metadata only. Object keys are unique within a bucket. Expired records are indexed for explicit cleanup, not TTL deletion: objects must be removed before their records. The S3 adapter is scoped to a configured bucket and uses the AWS SDK credential provider chain. Configure `MEDIA_S3_BUCKET`, `MEDIA_S3_REGION`, and optionally an HTTPS `MEDIA_S3_ENDPOINT`; configure credentials outside the repository. Provision a private bucket separately. Neither a bucket nor credentials have been verified.

The upload authorization mechanism, size-enforcing policy, random keys, validation and cleanup belong to later packages and remain to be implemented. Do not use this foundation to expose uploads yet. The in-memory adapter is a test double only. A real S3-compatible service and isolated MongoDB remain necessary for integration tests.

## Proposed frontend contract (not yet implemented)

Use authenticated upload sessions, direct binary upload with the exact signed method and headers, then authenticated completion by media ID. The server returns an avatar only after byte validation and persistence. URLs expire and must not be saved as permanent profile references. Endpoint names, payloads, limits and error codes remain to be agreed with the frontend sprint before implementation.

## Execution 1 — 2026-11-06

Foundation drafted: media schema and indexes, optional user reference, S3 read/delete adapter, configuration validation, isolated in-memory test double and unit tests. Package 1 remains incomplete until upload signing requirements and real adapter integration can be verified. No endpoints are available yet. Resume package 1 next run.

## Foundation continuation — 2026-11-06

Added put support and exercised the real SDK signing and request serialization with an in-process transport, including service and credential failures. This is not a real S3 or MongoDB integration test. Package 1 is complete as an isolated foundation; upload authorization is package 2. Credentials are resolved lazily by the SDK when a storage operation runs. No frontend contract has been agreed yet.
