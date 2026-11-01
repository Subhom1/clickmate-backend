import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const calls = { cert: [], initialize: [] };
const serviceAccount = { project_id: "local-test-project", client_email: "unit-test@example.test" };
const app = { name: "mock-firebase-app" };
const authClient = { verifyIdToken: async () => ({ uid: "test-user" }) };
const nodeMajorVersion = Number(process.versions.node.split(".")[0]);
const namedMock = (value) => nodeMajorVersion >= 26 ? { exports: value } : { namedExports: value };
mock.module("firebase-admin/app", namedMock({
  cert: (account) => { calls.cert.push(account); return "mock-credential"; },
  initializeApp: (options) => { calls.initialize.push(options); return app; },
}));
mock.module("firebase-admin/auth", namedMock({ getAuth: (firebaseApp) => firebaseApp === app ? authClient : null }));
const previousServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify(serviceAccount);
let admin;
try {
  ({ default: admin } = await import(pathToFileURL(resolve(process.cwd(), "FirebaseAdmin.js"))));
} finally {
  if (previousServiceAccount === undefined) delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  else process.env.FIREBASE_SERVICE_ACCOUNT_JSON = previousServiceAccount;
}

test("Firebase Admin initializes from the configured JSON credential", () => {
  assert.deepEqual(calls.cert, [serviceAccount]);
  assert.deepEqual(calls.initialize, [{ credential: "mock-credential" }]);
});

test("Firebase Admin exposes authentication for its initialized app", () => {
  assert.equal(admin.auth(), authClient);
});
