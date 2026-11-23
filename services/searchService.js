import UserDetail from "../models/UserDetailSchema.js";
import UserSearch from "../models/UserSearchSchema.js";
import { isValidObjectId } from "../utils/validation.js";

const SEARCH_TIMEOUT = 30000;
const CHECK_INTERVAL = 1000;
const MINIMUM_SIMILARITY = 0.5;
const TIME_TOLERANCE_MINUTES = 60;

const timeToMinutes = (time) => {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
};

const minutesToTime = (minutes) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

const scheduleFilter = ({ date, time }) => {
  const conditions = [];
  if (date) conditions.push({ $or: [{ date }, { date: null }] });
  if (time) {
    const minutes = timeToMinutes(time);
    conditions.push({ $or: [
      { time: { $gte: minutesToTime(Math.max(0, minutes - TIME_TOLERANCE_MINUTES)),
        $lte: minutesToTime(Math.min(1439, minutes + TIME_TOLERANCE_MINUTES)) } },
      { time: null },
    ] });
  }
  return conditions.length ? { $and: conditions } : {};
};

const scheduleMatches = (search, candidate) => {
  if (search.date && candidate.date && search.date !== candidate.date) return false;
  if (search.time && candidate.time &&
    Math.abs(timeToMinutes(search.time) - timeToMinutes(candidate.time)) > TIME_TOLERANCE_MINUTES) return false;
  return true;
};

export const createSearchService = (io, similarityService) => {
  const ongoingSearches = new Map();
  // Process-local observations only; no search text or user identifiers are stored.
  const metrics = { candidates: 0, comparisons: 0, cancellations: 0, timeouts: 0,
    failedPairClaims: 0, matches: 0, matchLatencyMsTotal: 0, matchLatencyMsMax: 0 };
  const userRoom = (userId) => `user:${userId}`;

  const lockUser = async (userId) => Boolean(await UserSearch.findOneAndUpdate(
    { userId, isLocked: { $ne: true } }, { isLocked: true }, { new: true }
  ));
  const unlockUser = (userId) => UserSearch.findOneAndUpdate({ userId }, { isLocked: false });

  const cleanupSearch = async (userId) => {
    const currentSearch = ongoingSearches.get(userId);
    if (currentSearch) metrics.cancellations++;
    if (currentSearch?.timer) clearTimeout(currentSearch.timer);
    currentSearch?.cancel?.();
    await UserSearch.deleteOne({ userId });
    await unlockUser(userId);
    ongoingSearches.delete(userId);
  };

  const lockMatchPair = async (userId, otherUserId) => {
    const selfLocked = await lockUser(userId);
    if (!selfLocked) return false;
    const otherLocked = await lockUser(otherUserId);
    if (!otherLocked) {
      await unlockUser(userId);
      return false;
    }
    return true;
  };

  const findMatch = (userId, query, schedule) => {
    const startedAt = Date.now();
    let cancelled = false;
    let timer = null;
    const similarityCache = new Map();
    const cancel = () => { cancelled = true; if (timer) clearTimeout(timer); };
    const scheduleNextCheck = () => {
      if (cancelled) return;
      timer = setTimeout(checkForMatches, CHECK_INTERVAL);
      const search = ongoingSearches.get(userId);
      if (search) search.timer = timer;
    };
    let attempts = 0;
    const maxAttempts = SEARCH_TIMEOUT / CHECK_INTERVAL;

    const checkForMatches = async () => {
      if (cancelled) return;
      attempts++;
      try {
        const candidates = await UserSearch.find({
          isLocked: false, userId: { $ne: userId }, ...scheduleFilter(schedule),
        })
          .sort({ created_at: 1 }).lean();
        if (cancelled) return;
        metrics.candidates += candidates.length;
        let bestMatch = null;
        let highestSimilarity = 0;
        for (const candidate of candidates) {
          if (cancelled) return;
          if (!scheduleMatches(schedule, candidate)) continue;
          const otherUserId = candidate.userId.toString();
          try {
            const timestamp = candidate.created_at ? new Date(candidate.created_at).getTime() : 0;
            const cacheKey = `${otherUserId}:${timestamp}`;
            let result = similarityCache.get(cacheKey);
            if (!result) {
              metrics.comparisons++;
              result = await similarityService.compare(candidate.query, query);
            }
            similarityCache.set(cacheKey, result);
            if (typeof result.similarity_score !== "number") continue;
            if (result.similarity_score > highestSimilarity) {
              bestMatch = otherUserId;
              highestSimilarity = result.similarity_score;
            }
          } catch (error) {
            console.error("Error running Python script:", error);
          }
        }

        if (cancelled) return;
        if (bestMatch && highestSimilarity >= MINIMUM_SIMILARITY) {
          if (!await lockMatchPair(userId, bestMatch)) {
            metrics.failedPairClaims++;
            return scheduleNextCheck();
          }
          // Read both profiles before stopping the partner loop or notifying either user.
          const user = await UserDetail.findOne({ _id: userId });
          const partner = await UserDetail.findOne({ _id: bestMatch });
          ongoingSearches.get(bestMatch)?.cancel?.();
          clearTimeout(timer);
          io.to(userRoom(bestMatch)).emit("search_update", {
            matches: { user, similarity: highestSimilarity },
            message: "Search result found",
          });
          io.to(userRoom(userId)).emit("search_update", {
            matches: { user: partner, similarity: highestSimilarity },
            message: "Search result found",
          });
          await UserSearch.deleteOne({ userId });
          await UserSearch.deleteOne({ userId: bestMatch });
          const latency = Date.now() - startedAt;
          metrics.matches++;
          metrics.matchLatencyMsTotal += latency;
          metrics.matchLatencyMsMax = Math.max(metrics.matchLatencyMsMax, latency);
          ongoingSearches.delete(userId);
          ongoingSearches.delete(bestMatch);
          return;
        }

        if (attempts < maxAttempts && !cancelled) return scheduleNextCheck();
        if (!cancelled) metrics.timeouts++;
        io.to(userRoom(userId)).emit("search_update", cancelled
          ? { cancel: true, message: "Search has been cancelled" }
          : { matches: null, message: "No result found" });
        await UserSearch.deleteOne({ userId });
        await unlockUser(userId);
        ongoingSearches.delete(userId);
      } catch (error) {
        if (cancelled) return;
        console.error("Error during match checking:", error);
        io.to(userRoom(userId)).emit("error", { message: "An error occurred while checking for matches." });
        await unlockUser(userId);
        ongoingSearches.delete(userId);
      }
    };

    timer = setTimeout(checkForMatches, 0);
    return { cancel, timer };
  };

  const startSearch = async (userId, query, socket, { date = null, time = null } = {}) => {
    await cleanupSearch(userId);
    await UserSearch.findOneAndUpdate(
      { userId }, { query, date, time, created_at: new Date(), isLocked: false },
      { upsert: true, runValidators: true }
    );
    const search = findMatch(userId, query, { date, time });
    ongoingSearches.set(userId, { socket, ...search });
  };

  const cleanupSocketSearches = async (socketId) => {
    const disconnected = [...ongoingSearches.entries()].filter(([, search]) => search.socket?.id === socketId);
    await Promise.all(disconnected.map(([userId]) => cleanupSearch(userId)));
  };

  const getMetrics = () => ({ ...metrics, activeSearches: ongoingSearches.size });
  const getMetricsReport = () => ({ search: getMetrics(), worker: similarityService.getMetrics() });
  return { userRoom, cleanupSearch, startSearch, cleanupSocketSearches, isValidObjectId, getMetrics, getMetricsReport };
};
