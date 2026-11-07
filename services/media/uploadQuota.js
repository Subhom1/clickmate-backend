export const MAX_SESSIONS_PER_HOUR = 10;
const HOUR_MS = 60 * 60 * 1000;

export function createUploadQuota({ quotas, now = () => new Date() }) {
  return async function consume(ownerId) {
    const hour = Math.floor(now().getTime() / HOUR_MS);
    // A single atomic upsert per owner and window is safe across processes.
    const record = await quotas.findOneAndUpdate(
      { _id: `${ownerId}:${hour}` },
      { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date((hour + 2) * HOUR_MS) } },
      { upsert: true, new: true, setDefaultsOnInsert: false }
    );
    if (record.count > MAX_SESSIONS_PER_HOUR) {
      const error = new Error("Too many upload requests");
      error.statusCode = 429;
      throw error;
    }
  };
}
