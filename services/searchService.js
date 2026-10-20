import UserDetail from "../models/UserDetailSchema.js";
import UserSearch from "../models/UserSearchSchema.js";
import { isValidObjectId } from "../utils/validation.js";

const SEARCH_TIMEOUT = 30000;
const CHECK_INTERVAL = 1000;
const MINIMUM_SIMILARITY = 0.5;

export const createSearchService = (io, similarityService) => {
  const ongoingSearches = new Map();
  const userRoom = (userId) => `user:${userId}`;

  const lockUser = async (userId) => Boolean(await UserSearch.findOneAndUpdate(
    { userId, isLocked: { $ne: true } }, { isLocked: true }, { new: true }
  ));
  const unlockUser = (userId) => UserSearch.findOneAndUpdate({ userId }, { isLocked: false });

  const cleanupSearch = async (userId) => {
    const currentSearch = ongoingSearches.get(userId);
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

  const findMatch = (userId, query) => {
    let cancelled = false;
    let timer = null;
    const similarityCache = new Map();
    const cancel = () => { cancelled = true; if (timer) clearTimeout(timer); };
    const scheduleNextCheck = () => {
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
        const candidates = await UserSearch.find({ isLocked: false, userId: { $ne: userId } })
          .sort({ created_at: 1 }).lean();
        let bestMatch = null;
        let highestSimilarity = 0;
        for (const candidate of candidates) {
          const otherUserId = candidate.userId.toString();
          try {
            const timestamp = candidate.created_at ? new Date(candidate.created_at).getTime() : 0;
            const cacheKey = `${otherUserId}:${timestamp}`;
            const result = similarityCache.get(cacheKey) ||
              await similarityService.compare(candidate.query, query);
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

        if (bestMatch && highestSimilarity >= MINIMUM_SIMILARITY && !cancelled) {
          if (!await lockMatchPair(userId, bestMatch)) return scheduleNextCheck();
          io.to(userRoom(bestMatch)).emit("search_update", {
            matches: { user: await UserDetail.findOne({ _id: userId }), similarity: highestSimilarity },
            message: "Search result found",
          });
          io.to(userRoom(userId)).emit("search_update", {
            matches: { user: await UserDetail.findOne({ _id: bestMatch }), similarity: highestSimilarity },
            message: "Search result found",
          });
          await UserSearch.deleteOne({ userId });
          await UserSearch.deleteOne({ userId: bestMatch });
          ongoingSearches.delete(userId);
          ongoingSearches.delete(bestMatch);
          return;
        }

        if (attempts < maxAttempts && !cancelled) return scheduleNextCheck();
        io.to(userRoom(userId)).emit("search_update", cancelled
          ? { cancel: true, message: "Search has been cancelled" }
          : { matches: null, message: "No result found" });
        await UserSearch.deleteOne({ userId });
        await unlockUser(userId);
        ongoingSearches.delete(userId);
      } catch (error) {
        console.error("Error during match checking:", error);
        io.to(userRoom(userId)).emit("error", { message: "An error occurred while checking for matches." });
        await unlockUser(userId);
        ongoingSearches.delete(userId);
      }
    };

    timer = setTimeout(checkForMatches, 0);
    return { cancel, timer };
  };

  const startSearch = async (userId, query, socket) => {
    await cleanupSearch(userId);
    await UserSearch.findOneAndUpdate(
      { userId }, { query, created_at: new Date(), isLocked: false }, { upsert: true }
    );
    const search = findMatch(userId, query);
    ongoingSearches.set(userId, { socket, ...search });
  };

  const cleanupSocketSearches = async (socketId) => {
    const disconnected = [...ongoingSearches.entries()].filter(([, search]) => search.socket?.id === socketId);
    await Promise.all(disconnected.map(([userId]) => cleanupSearch(userId)));
  };

  return { userRoom, cleanupSearch, startSearch, cleanupSocketSearches, isValidObjectId };
};
