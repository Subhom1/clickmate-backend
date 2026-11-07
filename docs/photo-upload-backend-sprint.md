# Profile photo backend sprint

## Progress

- [x] 1. Architecture, models and storage adapter
- [x] 2. Authenticated upload sessions (unit tested)
- [x] 3. Byte verification and image validation (unit tested)
- [x] 4. Profile persistence and safe replacement (unit tested)
- [x] 5. Retrieval, removal and cleanup (unit tested)
- [ ] 6. Security and reliability
- [ ] 7. Integration and staging readiness

## Small PR sequence

1. Storage and MongoDB foundation — merged as PR #14.
2. Upload policy, quota, session service and isolated tests — this branch. The router is deliberately unmounted while confirmation is missing.
3. Confirm uploads by reading and decoding the actual bytes, enforce image limits, and copy valid output to a canonical key that the signed form cannot overwrite.
4. Atomically attach and replace the user's avatar, then add authenticated retrieval and removal.
5. Clean up expired and unreferenced objects, add integration/security coverage, and document the frontend contract and staging prerequisites.

The image-validation branch adds a bounded Sharp decoder for JPEG, PNG and WebP, enforces square dimensions up to 2048×2048, rejects malformed or multi-page input, and returns freshly encoded JPEG bytes with client metadata stripped. This utility is not attached to an HTTP endpoint yet. Confirmation must still read and validate the stored object, compare its actual length with the session, write canonical bytes to a separate key, and only then update the profile reference.

The canonicalization branch adds bounded reading of the stored object, exact length comparison with the upload session, byte validation, and writing freshly encoded bytes under a key outside the signed upload prefix. The caller still needs to persist this key, manage retries and cleanup, and attach it to the authenticated profile. No route is enabled by this change.

The profile-attachment branch adds a retry-safe confirmation service: it checks ownership and expiry, records the canonical key with a compare-and-set update, then attaches the media ID to the existing user record. Repeated confirmation of an active avatar returns the same metadata; an old ready asset cannot restore a replacement. The HTTP route, retrieval, removal and orphan cleanup are still separate work.

## Avatar HTTP contract

All routes require `Authorization: Bearer <Firebase ID token>` and an existing ClickMate user record. `POST /v1/me/avatar/uploads` accepts JSON `{ "contentType": "image/jpeg", "sizeBytes": 123 }` and returns `201` with `mediaId`, `uploadUrl`, `method: "POST"`, `fields`, and `expiresAt`. JPEG, PNG and WebP are accepted up to 2 MiB; a MongoDB-backed limit allows 10 sessions per user per UTC hour. The client must send every returned field plus the binary file in a multipart POST to `uploadUrl`. The signed form lasts ten minutes and may be reused until expiry, so it is never the active avatar object.

`POST /v1/me/avatar/uploads/:mediaId/complete` checks the actual stored bytes, creates a canonical JPEG and attaches it to the authenticated profile. It returns `{ "success": true, "avatar": { "mediaId": "...", "url": "...", "width": 512, "height": 512, "contentType": "image/jpeg", "expiresAt": "..." } }`. `GET /v1/me/profile` returns `{ "avatar": null }` or that avatar object with a five-minute private read URL. `DELETE /v1/me/avatar` returns `{ "avatar": null }` and is safe to repeat. Clients must refresh the URL on expiry; MongoDB stores the media ID and object keys, never the signed URL or image bytes.

Expected errors use `{ "message": "CODE" }` for invalid session, expired session, missing upload, invalid image, size and dimensions, or a used prior avatar. Authentication follows the existing middleware's `{ "message": "..." }` format. Storage or database failures return `503` with a generic message. No live S3 or MongoDB integration has been verified. Configure a private S3-compatible bucket and credentials outside the repository before staging tests.

## Cleanup and staging limits

When storage configuration is present, the server runs cleanup once after startup and hourly. It considers only media whose upload session expired at least one hour ago, skips any media still referenced by a user, and deletes the signed upload object plus any recorded canonical object before marking the record expired. Failures leave the record eligible for retry. Concurrent instances may repeat an idempotent delete. Provision a bucket lifecycle policy for untracked objects under the upload and validated prefixes; a process crash between writing a canonical object and recording its key can otherwise leave an orphan. Do not apply a lifecycle rule to active canonical objects without checking that it preserves them.

The API can now be used by the frontend against a configured staging backend, but no live bucket, real MongoDB integration, frontend device test, or production permissions check has been performed. Do not treat the isolated unit tests as production verification.

Each PR should target the current `main` and be merged after its own checks pass. Frontend integration starts once the confirmation and profile response contract is live; mocked tests do not establish cloud readiness.

## Foundation and deployment prerequisites

The existing `user` collection stores an optional `avatarMediaId`; `media_assets` stores metadata only. Object keys are unique within a bucket. Expired records are indexed for explicit cleanup, not TTL deletion: objects must be removed before their records. The S3 adapter is scoped to a configured bucket and uses the AWS SDK credential provider chain. Configure `MEDIA_S3_BUCKET`, `MEDIA_S3_REGION`, and optionally an HTTPS `MEDIA_S3_ENDPOINT`; configure credentials outside the repository. Provision a private bucket separately. Neither a bucket nor credentials have been verified.

The upload authorization mechanism, size-enforcing policy, random keys, validation and cleanup belong to later packages and remain to be implemented. Do not use this foundation to expose uploads yet. The in-memory adapter is a test double only. A real S3-compatible service and isolated MongoDB remain necessary for integration tests.

## Proposed frontend contract (not yet implemented)

Use authenticated upload sessions, direct binary upload with the exact signed method and headers, then authenticated completion by media ID. The server returns an avatar only after byte validation and persistence. URLs expire and must not be saved as permanent profile references. Endpoint names, payloads, limits and error codes remain to be agreed with the frontend sprint before implementation.

## Execution 1 — 2026-11-06

Foundation drafted: media schema and indexes, optional user reference, S3 read/delete adapter, configuration validation, isolated in-memory test double and unit tests. Package 1 remains incomplete until upload signing requirements and real adapter integration can be verified. No endpoints are available yet. Resume package 1 next run.

## Foundation continuation — 2026-11-06

Added put support and exercised the real SDK signing and request serialization with an in-process transport, including service and credential failures. This is not a real S3 or MongoDB integration test. Package 1 is complete as an isolated foundation; upload authorization is package 2. Credentials are resolved lazily by the SDK when a storage operation runs. No frontend contract has been agreed yet.
