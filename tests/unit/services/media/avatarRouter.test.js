import { test } from "node:test";
import assert from "node:assert/strict";
import { createAvatarRouter } from "../../../../services/media/avatarRouter.js";

const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
async function execute(router, req) {
  const stack = router.stack[0].route.stack;
  const res = response();
  let index = 0;
  const next = () => stack[index++].handle(req, res, next);
  await next();
  return res;
}

async function executePath(router, path, req) {
  const stack = router.stack.find(layer => layer.route.path === path).route.stack;
  const res = response();
  let index = 0;
  const next = () => stack[index++].handle(req, res, next);
  await next();
  return res;
}

test("authentication and profile loading precede session creation", async () => {
  const calls = [];
  const router = createAvatarRouter({
    authenticate: (req, res, next) => { calls.push("auth"); return next(); },
    loadUser: (req, res, next) => { calls.push("user"); req.user = { _id: "owner" }; return next(); },
    createSession: async (owner, body) => { calls.push("create"); assert.equal(owner, "owner"); assert.equal(body.sizeBytes, 42); return { mediaId: "id" }; },
  });
  const res = await execute(router, { body: { sizeBytes: 42 } });
  assert.deepEqual(calls, ["auth", "user", "create"]); assert.equal(res.statusCode, 201); assert.deepEqual(res.body, { mediaId: "id" });
});

test("authentication failure stops session creation", async () => {
  const router = createAvatarRouter({
    authenticate: (req, res) => res.status(401).json({ message: "Authentication required" }),
    loadUser: () => assert.fail("must not load user"), createSession: () => assert.fail("must not create session"),
  });
  assert.equal((await execute(router, {})).statusCode, 401);
});

test("client errors are reported and internal errors are hidden", async () => {
  for (const [statusCode, expected] of [[400, 400], [429, 429], [undefined, 503]]) {
    const router = createAvatarRouter({ authenticate: (req, res, next) => next(), loadUser: (req, res, next) => { req.user = { _id: "owner" }; return next(); }, createSession: async () => { const error = Error("sensitive detail"); error.statusCode = statusCode; throw error; } });
    const res = await execute(router, { body: {} });
    assert.equal(res.statusCode, expected);
    if (!statusCode) assert.equal(res.body.message, "Upload session unavailable");
  }
});

test("completion and profile routes use the authenticated owner", async () => {
  const calls = [];
  const router = createAvatarRouter({
    authenticate: (_req, _res, next) => next(),
    loadUser: (req, _res, next) => { req.user = { _id: "owner" }; return next(); },
    complete: async (owner, id) => { calls.push(["complete", owner, id]); },
    getProfile: async owner => { calls.push(["profile", owner]); return { avatar: { mediaId: "media" } }; },
    remove: async owner => { calls.push(["remove", owner]); return { avatar: null }; },
  });
  const completed = await executePath(router, "/v1/me/avatar/uploads/:mediaId/complete", { params: { mediaId: "media" } });
  assert.deepEqual(completed.body, { success: true, avatar: { mediaId: "media" } });
  const profile = await executePath(router, "/v1/me/profile", {});
  assert.equal(profile.body.avatar.mediaId, "media");
  const removed = await executePath(router, "/v1/me/avatar", {});
  assert.deepEqual(removed.body, { avatar: null });
  assert.deepEqual(calls, [["complete", "owner", "media"], ["profile", "owner"], ["profile", "owner"], ["remove", "owner"]]);
});
