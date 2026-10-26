import test from "node:test";
import assert from "node:assert/strict";
import {
  authenticate,
  requireAdmin,
  requireOwnUser,
} from "../../../middleware/auth.js";

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
