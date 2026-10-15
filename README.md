# ClickMate Backend

ClickMate Backend is a Express server app to provide APIs for the ClickMate app

## Instruction to run the program

Node version required: v21.4.0


Visit the Node.js official website.

Download and install Node.js v21.4.0 from the available versions.

Ensure the correct version is installed by running: 
```bash
node -v
```
This should output v21.4.0.



go inside the project folder and use the node package manager npm to install the project dependency.
```bash
npm install
```

## Usage
Start the Express Project
once the installations are done, from the project folder inside open in terminal and run
```bash
npm start
```

## Configuration

Copy `.env.example` to `.env` and provide the MongoDB URI, allowed frontend origins,
and Firebase Admin credentials. Never commit `.env` or service-account credentials.

Protected HTTP endpoints require a Firebase ID token:

```http
Authorization: Bearer <firebase-id-token>
```

Socket.IO clients must provide the same token during the handshake:

```js
io("http://localhost:5051", {
  auth: { token: firebaseIdToken },
});
```

The `/health` endpoint returns the backend and MongoDB connection status.
