import { test } from "node:test";
import assert from "node:assert/strict";
import { createUploadQuota, MAX_SESSIONS_PER_HOUR } from "../../../../services/media/uploadQuota.js";

test("enforces a shared per-owner hourly limit using atomic increments", async () => {
  const rows = new Map();
  const quotas = { async findOneAndUpdate(filter, update, options) {
    assert.equal(options.upsert, true);
    const row = rows.get(filter._id) || { count: 0, expiresAt: update.$setOnInsert.expiresAt };
    row.count += update.$inc.count;
    rows.set(filter._id, row);
    return { ...row };
  } };
  const consume = createUploadQuota({ quotas, now: () => new Date("2026-01-01T12:15:00Z") });
  const results = await Promise.allSettled(Array.from({ length: MAX_SESSIONS_PER_HOUR + 4 }, () => consume("user-a")));
  assert.equal(results.filter(r => r.status === "fulfilled").length, MAX_SESSIONS_PER_HOUR);
  assert.equal(results.filter(r => r.status === "rejected" && r.reason.statusCode === 429).length, 4);
  await consume("user-b");
  assert.equal(rows.size, 2);
  assert.equal(rows.get(`user-a:${Math.floor(Date.parse("2026-01-01T12:15:00Z") / 3600000)}`).expiresAt.toISOString(), "2026-01-01T14:00:00.000Z");
});

test("database errors fail closed", async () => {
  const consume = createUploadQuota({ quotas: { findOneAndUpdate: async () => { throw Error("database unavailable"); } } });
  await assert.rejects(consume("user-a"), /database unavailable/);
});
