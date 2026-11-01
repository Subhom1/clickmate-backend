import test, { mock } from "node:test";
import assert from "node:assert/strict";

let verifyToken = async () => ({});
const profileCalls = { finds: [], updates: [] };
let profiles = [];
let profileError;
const userModelMock = {
  findOne: async (...args) => {
    profileCalls.finds.push(args);
    if (profileError) throw profileError;
    return profiles.shift() ?? null;
  },
  updateOne: async (...args) => { profileCalls.updates.push(args); },
};
const firebaseAdminMock = {
  auth: () => ({ verifyIdToken: (...args) => verifyToken(...args) }),
};
const moduleMockOptions = Number(process.versions.node.split(".")[0]) >= 26
  ? { exports: { default: firebaseAdminMock } }
  : { defaultExport: firebaseAdminMock };
const userModelMockOptions = Number(process.versions.node.split(".")[0]) >= 26
  ? { exports: { default: userModelMock } }
  : { defaultExport: userModelMock };

mock.module(new URL("../../../FirebaseAdmin.js", import.meta.url), moduleMockOptions);
mock.module(new URL("../../../models/UserDetailSchema.js", import.meta.url), userModelMockOptions);

const { authenticate, loadAuthenticatedUser, requireAdmin, requireOwnUser } =
  await import("../../../middleware/auth.js");

const responseRecorder = () => ({
  statusCode: 200,
  payload: undefined,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(payload) {
    this.payload = payload;
    return this;
  },
});

test("authenticate returns 401 when the authorization header is missing", async () => {
  const res = responseRecorder();
  let nextCalled = false;

  await authenticate({ get: () => undefined }, res, () => { nextCalled = true; });

  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.payload, { message: "Authentication required" });
  assert.equal(nextCalled, false);
});

test("authenticate returns 401 when the authorization scheme is not Bearer", async () => {
  const res = responseRecorder();

  await authenticate({ get: () => "Basic abc" }, res, () => {});

  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.payload, { message: "Authentication required" });
});

test("authenticate verifies a Bearer token and attaches its claims", async () => {
  verifyToken = async (token) => ({ uid: "firebase-user", token });
  const req = { get: () => "Bearer valid-token" };
  const res = responseRecorder();
  let nextCalled = false;

  await authenticate(req, res, () => { nextCalled = true; });

  assert.deepEqual(req.auth, { uid: "firebase-user", token: "valid-token" });
  assert.equal(nextCalled, true);
});

test("loadAuthenticatedUser rejects token claims without a usable email", async () => {
  const res = responseRecorder();
  let nextCalled = false;
  await loadAuthenticatedUser({ auth: { uid: "firebase-user" } }, res, () => { nextCalled = true; });
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.payload, { message: "Authenticated email is required" });
  assert.equal(nextCalled, false);
});

test("loadAuthenticatedUser falls back to email and links a legacy profile to its Firebase UID", async () => {
  profileCalls.finds.length = 0;
  profileCalls.updates.length = 0;
  profiles = [null, { _id: { toString: () => "profile-1" }, email: "alice@example.com" }];
  const req = { auth: { uid: "firebase-user", email: " Alice@Example.com " } };
  let nextCalled = false;
  await loadAuthenticatedUser(req, responseRecorder(), () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(req.user.firebaseUid, "firebase-user");
  assert.deepEqual(profileCalls.finds, [[{ firebaseUid: "firebase-user" }], [{ email: "alice@example.com" }]]);
  assert.deepEqual(profileCalls.updates, [[{ _id: req.user._id }, { $set: { firebaseUid: "firebase-user" } }]]);
});

test("loadAuthenticatedUser uses a profile found by Firebase UID without an email fallback", async () => {
  profileCalls.finds.length = 0;
  profileCalls.updates.length = 0;
  const profile = { _id: "profile-2", firebaseUid: "firebase-user" };
  profiles = [profile];
  const req = { auth: { uid: "firebase-user", email: "alice@example.com" } };
  await loadAuthenticatedUser(req, responseRecorder(), () => {});
  assert.equal(req.user, profile);
  assert.equal(profileCalls.finds.length, 1);
  assert.equal(profileCalls.updates.length, 0);
});

test("loadAuthenticatedUser rejects an identity with no application profile", async () => {
  profileCalls.finds.length = 0;
  profiles = [null, null];
  const res = responseRecorder();
  await loadAuthenticatedUser({ auth: { uid: "missing-user", email: "missing@example.com" } }, res, () => {});
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.payload, { message: "User profile not found" });
});

test("loadAuthenticatedUser forwards database errors to Express", async () => {
  profileError = new Error("database unavailable");
  let forwarded;
  await loadAuthenticatedUser({ auth: { uid: "firebase-user", email: "alice@example.com" } }, responseRecorder(), (error) => { forwarded = error; });
  assert.equal(forwarded, profileError);
  profileError = null;
});

test("requireAdmin permits an admin claim", () => {
  let nextCalled = false;

  requireAdmin({ auth: { admin: true } }, responseRecorder(), () => { nextCalled = true; });

  assert.equal(nextCalled, true);
});

test("requireAdmin permits the admin role claim", () => {
  let nextCalled = false;

  requireAdmin({ auth: { role: "admin" } }, responseRecorder(), () => { nextCalled = true; });

  assert.equal(nextCalled, true);
});

test("requireAdmin rejects a regular user", () => {
  const res = responseRecorder();
  let nextCalled = false;

  requireAdmin({ auth: { role: "user" } }, res, () => { nextCalled = true; });

  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.payload, { message: "Administrator access required" });
  assert.equal(nextCalled, false);
});

test("requireOwnUser permits a request for the authenticated user", () => {
  let nextCalled = false;

  requireOwnUser(
    { params: { userId: "user-123" }, user: { _id: { toString: () => "user-123" } } },
    responseRecorder(),
    () => { nextCalled = true; }
  );

  assert.equal(nextCalled, true);
});

test("requireOwnUser rejects a request for a different user", () => {
  const res = responseRecorder();
  let nextCalled = false;

  requireOwnUser(
    { params: { userId: "other-user" }, user: { _id: { toString: () => "user-123" } } },
    res,
    () => { nextCalled = true; }
  );

  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.payload, { message: "You can only access your own user" });
  assert.equal(nextCalled, false);
});
