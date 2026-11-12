# MongoDB avatar storage

ClickMate stores each processed profile photo in the `avatar_files` collection.
The user document holds only `avatarFileId`. The authenticated upload endpoint
accepts a square JPEG no larger than 2 MiB. Sharp validates and re-encodes the
bytes before storage, stripping client metadata. Each saved document contains
`ownerId`, `bytes`, `contentType`, `width`, `height`, and timestamps. MongoDB
creates the collection on the first successful upload; no Atlas console change
or GridFS bucket is required for these small files.

## API contract

Every route requires a Firebase ID token in `Authorization: Bearer <token>`.
The caller must have a registered ClickMate profile for write and metadata
routes. The image read route allows authenticated app users to display an
avatar by its opaque MongoDB ID.

| Request | Response |
| --- | --- |
| `POST /v1/me/avatar-file` multipart field `file` (`image/jpeg`) | `201 {"avatar":{"mediaId":"<id>","contentType":"image/jpeg","width":512,"height":512}}` |
| `GET /v1/me/avatar-file` | `200 {"avatar":<metadata or null>}` |
| `GET /v1/avatar-files/:mediaId` | `200` JPEG bytes with private cache header |
| `DELETE /v1/me/avatar-file` | `200 {"avatar":null}` |

The frontend constructs the image URL from `mediaId` and the configured API
origin and sends a fresh ID token when rendering it. A replacement switches
the user's pointer only after validation and storage succeed, then removes the
old bytes. Delete clears the pointer before removing bytes. A failed old-file
cleanup may leave an unreachable document; operational cleanup should remove
any `avatar_files` record not referenced by a user.

MongoDB recommends GridFS for files larger than its 16 MiB document limit;
these capped avatar files fit in a normal document. See the
[MongoDB GridFS guide](https://www.mongodb.com/docs/manual/core/gridfs/).

This backend keeps the older S3 routes for compatibility. The MongoDB route is
the one used by the current frontend feature branch. Production still needs
deployment configuration and device acceptance; a passing mock or local test
does not establish production integration.
