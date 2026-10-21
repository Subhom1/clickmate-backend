# ClickMate Backend

ClickMate Backend is the Express and Socket.IO service used by ClickMate for user profiles, interest discovery, semantic matching, and chat. MongoDB stores application data, while Firebase Authentication supplies the identity used by HTTP and WebSocket clients.

## Architecture

The service consists of:

- **Express API** for profiles, interests, explore content, chats, uploads, and health checks.
- **Socket.IO** for authenticated keyword matching and real-time chat.
- **MongoDB/Mongoose** for users, interests, explore categories, chats, and active searches.
- **Python similarity worker** for sentence-transformer comparisons. The model is loaded once at startup and receives newline-delimited JSON requests from Node.js.

The application is organized by responsibility:

- `app.js` bootstraps Express, Socket.IO, middleware, routes, and graceful shutdown.
- `config/` contains environment and MongoDB lifecycle configuration.
- `middleware/` contains authentication, authorization, and upload validation.
- `routes/` contains the user, content, and chat HTTP APIs. Route paths and response contracts remain unchanged.
- `services/` contains reusable chat persistence, similarity-worker, and matchmaking logic.
- `sockets/` contains authenticated Socket.IO event registration.
- `utils/` contains shared validation and normalization helpers.

The server waits for MongoDB, the optional Socket.IO Mongo adapter, and the similarity worker before listening.

## Requirements

- Node.js 21.4.0, or a compatible newer LTS release
- npm
- MongoDB; use a replica set or MongoDB Atlas when the Socket.IO Mongo adapter is enabled
- Python 3 with `sentence-transformers`
- A Firebase project and Firebase Admin service-account credentials

## Installation

```bash
git clone https://github.com/Subhom1/clickmate-backend.git
cd clickmate-backend
npm install

python3 -m venv .venv
. .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install sentence-transformers
```

The first worker startup downloads the `paraphrase-mpnet-base-v2` model if it is not cached. Pre-cache it during deployment when runtime network access is restricted.

## Configuration

Create a local `.env` file from `.env.example`:

| Variable | Required | Description |
| --- | --- | --- |
| `MONGODB_URI` | Yes | MongoDB connection string. |
| `CORS_ORIGIN` | Recommended | Comma-separated permitted frontend origins. Without it, browser cross-origin requests are rejected. |
| `FIREBASE_SERVICE_ACCOUNT_PATH` | One credential option | Path to the Firebase Admin service-account JSON. |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | One credential option | Complete service-account JSON, useful with a secret manager. |
| `PORT` | No | HTTP port; defaults to `5051`. |
| `PYTHON_BIN` | No | Worker Python executable; defaults to `python3`. |
| `SOCKET_ADAPTER_ENABLED` | No | Defaults to enabled; set `false` for a single-process local setup. |
| `RATE_LIMIT_WINDOW_MS` | No | HTTP rate-limit window; defaults to 15 minutes. |
| `RATE_LIMIT_MAX` | No | HTTP requests per window; defaults to 300. |

Example:

```env
MONGODB_URI=mongodb://127.0.0.1:27017/clickmate
CORS_ORIGIN=http://localhost:3000
FIREBASE_SERVICE_ACCOUNT_PATH=/absolute/path/to/firebase-service-account.json
PORT=5051
PYTHON_BIN=/absolute/path/to/.venv/bin/python
SOCKET_ADAPTER_ENABLED=false
```

Never commit `.env`, service-account JSON, access tokens, or database credentials.

## Running the service

```bash
npm run check
npm start
```

Use `npm run dev` for automatic restarts during development. Check readiness with:

```bash
curl http://localhost:5051/health
```

The health endpoint returns HTTP 200 with `status: "ok"` when MongoDB is connected and HTTP 503 with `status: "degraded"` otherwise.

## Authentication and authorization

Protected HTTP routes require:

```http
Authorization: Bearer <firebase-id-token>
```

The server verifies the Firebase token, resolves the MongoDB profile by Firebase UID (with an email fallback for existing records), and enforces ownership or chat participation. Admin routes require the Firebase custom claim `admin: true` or `role: "admin"`.

Socket.IO clients use the same token:

```js
const socket = io("http://localhost:5051", {
  auth: { token: firebaseIdToken },
});
```

Each authenticated socket joins only its private user room. Chat rooms require a server-side participant check.

## HTTP API

| Method | Endpoint | Purpose | Access |
| --- | --- | --- | --- |
| `GET` | `/health` | Service and MongoDB status. | Public |
| `POST` | `/register` | Create a profile from the verified Firebase identity. | Authenticated |
| `GET` | `/user/:email` | Fetch the authenticated user's profile. | Own user |
| `GET` | `/users/:userId/friends` | List friends. | Own user |
| `PATCH` | `/user/:userId` | Update name, bio, interests, and timestamp. | Own user |
| `DELETE` | `/deleteUser/:uid` | Delete Firebase and MongoDB user records. | Own user |
| `GET` | `/interests` | List interests. | Public |
| `GET` | `/explore` | List explore categories and items. | Public |
| `POST` | `/create-chat` | Create or return the unique chat for two users. | Chat participant |
| `GET` | `/chat/:user1Id/:user2Id` | Fetch a chat between participants. | Chat participant |
| `GET` | `/unread-messages/:userId` | Return unread counts for the user's chats. | Own user |
| `POST` | `/add-explore-category` | Create an empty explore category. | Admin |
| `POST` | `/add-items/:categoryId` | Add up to ten text/image items. | Admin |

### Explore uploads

`POST /add-items/:categoryId` accepts `multipart/form-data`:

- `items`: JSON array of one to ten objects containing `text`.
- `images`: one JPEG, PNG, or GIF for each item, in matching order.

Each file is limited to 5 MB. The extension and declared MIME type must agree, then the file signature is inspected. If validation fails after earlier files were written, those files are removed.

## Socket.IO events

### Search matching

```js
socket.emit("submit_keyword", { userId, query });
socket.emit("cancel_search", { userId });
```

The user ID must belong to the authenticated socket. Searches are stored in MongoDB with a five-minute TTL index. Candidate queries are compared by the Python worker; a private match is emitted when similarity reaches `0.5`. Atomic pair locking prevents duplicate matches across server instances.

Listen for `search_update` with a match, `matches: null` on timeout, or `cancel: true` after cancellation. Validation and worker failures use the `error` event.

### Chat

```js
socket.emit("joinChat", { chatId });
socket.emit("sendMessage", {
  chatId,
  message: { sender: userId, content: "Hello" },
});
socket.emit("markAsRead", { chatId, userId });
socket.emit("clearMessages", { chatId });
socket.emit("leaveChat", { chatId });
```

Every operation checks chat membership. Messages are limited to 5,000 characters and the sender must match the authenticated user. Clients receive `receiveMessage`, `updateUnreadCounts`, and `messagesCleared` notifications.

## Security and reliability

- Helmet adds baseline security headers.
- CORS allows only configured origins.
- HTTP requests and selected socket events are rate-limited.
- Firebase tokens are verified server-side.
- Ownership, chat participation, socket-room, and admin checks are enforced at the API boundary.
- Uploaded content is checked by file signature and invalid files are removed.
- Client errors are generic; detailed diagnostics stay in server logs.
- SIGINT and SIGTERM stop the worker, close HTTP, and disconnect MongoDB.

## Verification and troubleshooting

```bash
npm test
git diff --check
npm audit --omit=dev
```

If startup fails, verify `MONGODB_URI`, the Firebase credential option, and `PYTHON_BIN`. Confirm that the similarity model can be downloaded or is already cached. For a local MongoDB instance without a replica set, set `SOCKET_ADAPTER_ENABLED=false`.

Use a separate database and Firebase project for local development. Do not run verification against production credentials or data.

## Production checklist

- Configure an explicit `CORS_ORIGIN` allowlist.
- Store MongoDB and Firebase credentials in a secret manager.
- Use a replica-set MongoDB deployment when the Socket.IO adapter is enabled.
- Pre-cache the sentence-transformer model.
- Run behind TLS and a reverse proxy configured for WebSocket upgrades.
- Monitor `/health`, worker failures, MongoDB connectivity, rate limits, and process restarts.
- Review dependency advisories before releases.

See [PRODUCTION_BACKEND.md](PRODUCTION_BACKEND.md) for deeper production architecture and operational rationale.
