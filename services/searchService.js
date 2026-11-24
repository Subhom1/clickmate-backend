import { randomUUID } from "node:crypto";
import UserDetail from "../models/UserDetailSchema.js";
import UserSearch from "../models/UserSearchSchema.js";
import { isValidObjectId } from "../utils/validation.js";
import { searchAvailability, availabilityOverlaps } from "../utils/searchAvailability.js";

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

const scheduleFilter = ({ date, time, availabilityStart, availabilityEnd }) => {
  if (availabilityStart && availabilityEnd) {
    return { $or: [
      { availabilityStart: { $lte: availabilityEnd }, availabilityEnd: { $gte: availabilityStart } },
      { availabilityStart: null, date: null, time: null },
    ] };
  }
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
  return conditions.length ? { availabilityStart: null, $and: conditions } : {};
};

const scheduleMatches = (search, candidate) => {
  const searchZoned = search.availabilityStart != null && search.availabilityEnd != null;
  const candidateZoned = candidate.availabilityStart != null && candidate.availabilityEnd != null;
  if (searchZoned && candidateZoned) return availabilityOverlaps(
    { startMs: new Date(search.availabilityStart).getTime(), endMs: new Date(search.availabilityEnd).getTime() },
    { startMs: new Date(candidate.availabilityStart).getTime(), endMs: new Date(candidate.availabilityEnd).getTime() }
  );
  if (searchZoned) return !candidate.date && !candidate.time;
  if (candidateZoned) return !search.date && !search.time;
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

  const lockUser = (userId) => UserSearch.findOneAndUpdate(
    { userId, isLocked: { $ne: true } }, { isLocked: true }, { new: true }
  );
  const unlockUser = (userId, searchId) => UserSearch.findOneAndUpdate({ userId, searchId }, { isLocked: false });
  const unlockClaim = (claim) => UserSearch.findOneAndUpdate(
    { _id: claim._id, isLocked: true }, { isLocked: false }
  );

  const cleanupSearch = async (userId) => {
    const currentSearch = ongoingSearches.get(userId);
    if (currentSearch) metrics.cancellations++;
    if (currentSearch?.timer) clearTimeout(currentSearch.timer);
    currentSearch?.cancel?.();
    // A delayed cleanup must not delete a later locally tracked attempt.
    const filter = currentSearch?.searchId ? { userId, searchId: currentSearch.searchId } : { userId };
    await UserSearch.deleteOne(filter);
    if (ongoingSearches.get(userId) === currentSearch) ongoingSearches.delete(userId);
  };

  const lockMatchPair = async (userId, otherUserId) => {
    const selfLocked = await lockUser(userId);
    if (!selfLocked) return false;
    const otherLocked = await lockUser(otherUserId);
    if (otherLocked) return [selfLocked, otherLocked];
    await unlockClaim(selfLocked);
    return false;
  };

  const findMatch = (userId, query, schedule, searchId) => {
    const startedAt = Date.now();
    let cancelled = false;
    let timer = null;
    const similarityCache = new Map();
    const cancel = () => { cancelled = true; if (timer) clearTimeout(timer); };
    const scheduleWork = (callback) => {
      if (cancelled) return;
      const search = ongoingSearches.get(userId);
      if (search?.searchId !== searchId) return;
      timer = setTimeout(callback, CHECK_INTERVAL);
      search.timer = timer;
    };
    const scheduleNextCheck = () => scheduleWork(checkForMatches);
    let attempts = 0;
    const maxAttempts = SEARCH_TIMEOUT / CHECK_INTERVAL;

    const expireSearch = async () => {
      if (cancelled || ongoingSearches.get(userId)?.searchId !== searchId) return;
      try {
        const expired = await UserSearch.deleteOne({ userId, searchId, isLocked: { $ne: true } });
        if (cancelled || ongoingSearches.get(userId)?.searchId !== searchId) return;
        if (!expired.deletedCount) {
          const current = await UserSearch.findOne({ userId, searchId }).lean();
          if (cancelled || ongoingSearches.get(userId)?.searchId !== searchId) return;
          if (current) return scheduleWork(expireSearch);
          ongoingSearches.delete(userId);
          return;
        }
        metrics.timeouts++;
        io.to(userRoom(userId)).emit("search_update", { matches: null, message: "No result found" });
        ongoingSearches.delete(userId);
      } catch (error) {
        if (cancelled || ongoingSearches.get(userId)?.searchId !== searchId) return;
        console.error("Error during search expiration:", error);
        io.to(userRoom(userId)).emit("error", { message: "An error occurred while checking for matches." });
        ongoingSearches.delete(userId);
      }
    };

    const checkForMatches = async () => {
      if (cancelled) return;
      attempts++;
      let claims = null;
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
          claims = await lockMatchPair(userId, bestMatch);
          if (!claims) {
            metrics.failedPairClaims++;
            return scheduleNextCheck();
          }
          // Read both profiles before stopping the partner loop or notifying either user.
          const user = await UserDetail.findOne({ _id: userId });
          const partner = await UserDetail.findOne({ _id: bestMatch });
          // Once notifications begin, do not roll both claims back on a later failure.
          claims = null;
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
        return expireSearch();
      } catch (error) {
        if (claims) await Promise.all(claims.map(unlockClaim));
        if (cancelled || ongoingSearches.get(userId)?.searchId !== searchId) return;
        console.error("Error during match checking:", error);
        io.to(userRoom(userId)).emit("error", { message: "An error occurred while checking for matches." });
        if (!claims) await unlockUser(userId, searchId);
        if (ongoingSearches.get(userId)?.searchId === searchId) ongoingSearches.delete(userId);
      }
    };

    timer = setTimeout(checkForMatches, 0);
    return { cancel, timer };
  };

  const startSearch = async (userId, query, socket, { date = null, time = null, timeZone = null, utcOffsetMinutes = null } = {}) => {
    const interval = timeZone != null || utcOffsetMinutes != null
      ? searchAvailability({ date, time, timeZone, utcOffsetMinutes }) : null;
    const schedule = { date, time, timeZone, utcOffsetMinutes,
      availabilityStart: interval ? new Date(interval.startMs) : null,
      availabilityEnd: interval ? new Date(interval.endMs) : null };
    await cleanupSearch(userId);
    const searchId = randomUUID();
    await UserSearch.findOneAndUpdate(
      { userId }, { searchId, query, ...schedule, created_at: new Date(), isLocked: false },
      { upsert: true, runValidators: true }
    );
    const search = findMatch(userId, query, schedule, searchId);
    ongoingSearches.set(userId, { searchId, socket, ...search });
  };

  const cleanupSocketSearches = async (socketId) => {
    const disconnected = [...ongoingSearches.entries()].filter(([, search]) => search.socket?.id === socketId);
    await Promise.all(disconnected.map(([userId]) => cleanupSearch(userId)));
  };

  const getMetrics = () => ({ ...metrics, activeSearches: ongoingSearches.size });
  const getMetricsReport = () => ({ search: getMetrics(), worker: similarityService.getMetrics() });
  return { userRoom, cleanupSearch, startSearch, cleanupSocketSearches, isValidObjectId, getMetrics, getMetricsReport };
};
