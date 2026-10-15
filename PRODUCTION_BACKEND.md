# ClickMate backend production guide

This document describes the production hardening applied to the ClickMate backend, how the main features work, and how to operate the service safely.

## Runtime architecture

- Express serves the HTTP API and static uploaded images.
- MongoDB stores users, chats, interests, explore categories, and active searches.
- Firebase Admin verifies Firebase ID tokens. A verified Firebase UID is linked to the Mongo user record; email is retained as a compatibility fallback for existing records.
- Socket.IO provides authenticated search and chat events.
- MongoDB's Socket.IO adapter publishes room events through the database so multiple backend instances can serve the same users.
- A persistent Python worker loads the sentence-transformer model once and accepts newline-delimited JSON requests. This avoids loading a large model for every comparison.

## Configuration

Copy `.env.example` to `.env` and set:

| Variable | Purpose |
| --- | --- |
| `MONGODB_URI` | MongoDB connection string. Use a replica set or MongoDB Atlas for the Socket.IO adapter. |
| `CORS_ORIGIN` | Comma-separated frontend origins. Requests from unspecified origins are rejected. |
| `FIREBASE_SERVICE_ACCOUNT_PATH` | Optional path to the Firebase service-account JSON file. `FIREBASE_SERVICE_ACCOUNT_JSON` may be used for a secret-manager JSON value. |
| `PORT` | HTTP port, default `5051`. |
| `PYTHON_BIN` | Python executable containing `sentence-transformers`, default `python3`. |
| `SOCKET_ADAPTER_ENABLED` | Keep `true` in production. Set `false` only for a single-process local MongoDB instance. |
| `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX` | Global API rate-limit window and request count. |

Never commit `.env`, Firebase service-account JSON, tokens, or database credentials.

## Authentication and authorization

HTTP routes that read or change user data require `Authorization: Bearer <Firebase ID token>`. The server verifies the token, resolves the Mongo profile, and checks ownership or chat participation before accessing data. Registration also requires a Firebase token and derives the email from the verified token instead of trusting a client-supplied identity.

Socket connections must send the token in the handshake:

```js
const socket = io(API_URL, { auth: { token: firebaseIdToken } });
```

Each authenticated socket joins only its private room, `user:<mongo-user-id>`. Search results are emitted to those private rooms, never to arbitrary client-supplied rooms. `joinChat` additionally checks that the authenticated user is a participant before joining a chat room. Message, read, clear, search, and cancellation events repeat ownership checks server-side.

## Search matching

An active search is a MongoDB document with a TTL index. A process-local map stores only timers and cancellation callbacks; it is not the source of truth. Candidate searches can therefore be discovered by any backend instance. Pair locking uses atomic MongoDB updates so two workers cannot successfully claim the same user pair. Search results are delivered through private Socket.IO rooms and the Mongo adapter.

The similarity worker loads `paraphrase-mpnet-base-v2` once at startup. Requests and responses are correlated by an ID, have a timeout, and fail safely if the worker exits. The server does not begin listening until MongoDB, the adapter, and the similarity worker are ready.

## Chat behavior

Chats have a normalized, sorted `conversationKey`, making creation idempotent for a pair of users. The sparse unique index prevents new duplicate conversations while remaining compatible with legacy chat documents that do not yet have a key. All chat reads and writes require the caller to be a participant.

## Upload safety

Uploads are limited by count, field size, and a five-megabyte file size limit. The extension and declared MIME type must agree, then `file-type` inspects the actual file signature. Invalid files are removed from disk. Uploaded item text is trimmed and limited to 500 characters.

## Reliability and operations

- Helmet adds baseline HTTP security headers.
- Express rate limiting protects API endpoints; selected Socket.IO events also have per-connection limits.
- The service waits for MongoDB and the similarity worker before listening.
- `/health` returns HTTP 200 only when MongoDB is connected.
- SIGINT and SIGTERM stop the similarity worker, close the HTTP server, and disconnect MongoDB.
- Errors returned to clients are generic; detailed diagnostics stay in server logs.

## Development and verification

```bash
npm install
npm run check
npm start
```

In another terminal:

```bash
curl http://localhost:5051/health
npm audit --omit=dev
```

For a two-user search test, sign in two existing Firebase users, obtain their ID tokens, connect both clients with the Socket.IO handshake token, submit their own Mongo user IDs and similar keywords, and verify that each client receives exactly one `search_update`. Do not use production credentials or create test data in the production database.

## Deployment checklist

- Use MongoDB Atlas or another replica-set deployment when `SOCKET_ADAPTER_ENABLED=true`.
- Set an explicit production `CORS_ORIGIN` list.
- Store the Firebase service account and MongoDB URI in the deployment secret manager.
- Install the Python dependencies required by `scripts/similarity_worker.py` and validate model availability during deployment.
- Put the service behind TLS and a reverse proxy/load balancer with WebSocket support.
- Monitor `/health`, process restarts, worker errors, rate-limit responses, and MongoDB connection events.
- Review remaining transitive dependency advisories before each release; do not apply breaking audit fixes without testing.
