const User = require("../models/User");
const PageEvent = require("../models/PageEvent");
const { fetchNearbyPlaces } = require("./places");
const { aiHookConfigured, callAIHook } = require("./aiHook");
const { fetchAmplitudeUserContext } = require("./amplitudeExport");

// In-memory caches
const placesCache = new Map(); // Key: "lat,lon", Value: { data, timestamp }
const amplitudeCache = new Map(); // Key: userId, Value: { data, timestamp }
const suggestionsCache = new Map(); // Key: userId, Value: { suggestions, context, timestamp }

const PLACE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const AMP_CACHE_TTL = 60 * 1000; // 1 minute
const SUGGESTION_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours (Stable cache until manual refresh)
const EARTH_RADIUS_KM = 6371;

function computeDistanceKm(lat1, lon1, lat2, lon2) {
  if (
    typeof lat1 !== "number" ||
    typeof lon1 !== "number" ||
    typeof lat2 !== "number" ||
    typeof lon2 !== "number"
  ) {
    return null;
  }
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(EARTH_RADIUS_KM * c * 10) / 10;
}

async function buildPageContext(currentUser) {
  const now = new Date();
  const friendIds = currentUser.friends || [];
  const friends = await User.find({
    _id: { $in: friendIds },
  }).select(
    "firstName lastName email lat lon available isBusy lastSeen uniqueId profilePicture",
  );

  const events = await PageEvent.find({
    fromUser: currentUser._id,
    toUser: { $in: friendIds },
  })
    .sort({ createdAt: -1 })
    .limit(200)
    .lean();

  const stats = new Map();
  events.forEach((evt) => {
    const key = String(evt.toUser);
    if (!stats.has(key)) {
      stats.set(key, { total: 0, accepted: 0, lastPageAt: null });
    }
    const entry = stats.get(key);
    entry.total += 1;
    if (evt.status === "accepted") entry.accepted += 1;
    if (!entry.lastPageAt) entry.lastPageAt = evt.createdAt;
    stats.set(key, entry);
  });

  const friendContexts = friends.map((f) => {
    const s = stats.get(String(f._id)) || {
      total: 0,
      accepted: 0,
      lastPageAt: null,
    };
    const acceptanceRate =
      s.total > 0 ? Number(((s.accepted / s.total) * 100).toFixed(1)) : 0;
    const distanceKm = computeDistanceKm(
      currentUser.lat,
      currentUser.lon,
      f.lat,
      f.lon,
    );
    const lastSeenMinutesAgo = f.lastSeen
      ? Math.round((now - new Date(f.lastSeen)) / 60000)
      : null;

    return {
      id: String(f._id),
      uniqueId: f.uniqueId,
      name: `${f.firstName} ${f.lastName}`.trim(),
      email: f.email,
      available: f.available,
      isBusy: f.isBusy,
      lastSeen: f.lastSeen,
      lastSeenMinutesAgo,
      location: f.lat && f.lon ? { lat: f.lat, lon: f.lon } : null,
      distanceKm,
      pageHistory: {
        total: s.total,
        accepted: s.accepted,
        acceptanceRate,
        lastPageAt: s.lastPageAt,
      },
    };
  });

  return {
    generatedAt: now.toISOString(),
    user: {
      id: String(currentUser._id),
      name: `${currentUser.firstName} ${currentUser.lastName}`.trim(),
      email: currentUser.email,
      available: currentUser.available,
      isBusy: currentUser.isBusy,
      location:
        currentUser.lat && currentUser.lon
          ? { lat: currentUser.lat, lon: currentUser.lon }
          : null,
    },
    friends: friendContexts,
  };
}

function fallbackSuggestions(friendContexts, currentUser) {
  const suggestions = [];

  if (!currentUser.available) {
    suggestions.push({
      type: "go_available",
      label: "Share your location",
      reason: "Turn on availability so friends can see and page you.",
    });
  }

  const pageCandidates = friendContexts
    .filter((f) => f.available && !f.isBusy)
    .sort((a, b) => {
      // Highest acceptance rate first, then closest distance, then freshest last seen
      const rateDiff =
        (b.pageHistory.acceptanceRate || 0) -
        (a.pageHistory.acceptanceRate || 0);
      if (rateDiff !== 0) return rateDiff;
      const distA = typeof a.distanceKm === "number" ? a.distanceKm : Infinity;
      const distB = typeof b.distanceKm === "number" ? b.distanceKm : Infinity;
      if (distA !== distB) return distA - distB;
      const seenA =
        typeof a.lastSeenMinutesAgo === "number"
          ? a.lastSeenMinutesAgo
          : Infinity;
      const seenB =
        typeof b.lastSeenMinutesAgo === "number"
          ? b.lastSeenMinutesAgo
          : Infinity;
      return seenA - seenB;
    })
    .slice(0, 3);

  pageCandidates.forEach((f) => {
    suggestions.push({
      type: "page_friend",
      label: `Page ${f.name || f.email}`,
      reason: [
        f.distanceKm ? `${f.distanceKm}km away` : "Distance unknown",
        f.pageHistory.acceptanceRate
          ? `${f.pageHistory.acceptanceRate}% past accept rate`
          : "No response history yet",
      ]
        .filter(Boolean)
        .join(" • "),
      data: { userId: f.id },
    });
  });

  if (currentUser.available && !currentUser.isBusy && !pageCandidates.length) {
    suggestions.push({
      type: "go_busy",
      label: "Set Busy mode",
      reason: "No friends are available; toggle DND if you want to mute pages.",
    });
  }

  return suggestions;
}

async function getSuggestions(user, forceRefresh = false) {
  if (!user) return { suggestions: [], context: {} };

  const userId = String(user._id);

  // 1. Check Cache
  if (!forceRefresh) {
    const cached = suggestionsCache.get(userId);
    if (cached && Date.now() - cached.timestamp < SUGGESTION_CACHE_TTL) {
      console.log(`Returning cached suggestions for ${user.email}`);
      return {
        suggestions: cached.suggestions,
        context: cached.context,
        fromCache: true,
      };
    }
  } else {
    // Explicitly invalidate
    suggestionsCache.delete(userId);
  }

  // 2. Generate New
  console.log(`Generating new suggestions for ${user.email}...`);
  const aiContext = await buildPageContext(user);

  // Fetch nearby places
  let places = [];
  if (user.lat && user.lon) {
    const cacheKey = `${user.lat.toFixed(3)},${user.lon.toFixed(3)}`;
    const cached = placesCache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < PLACE_CACHE_TTL) {
      places = cached.data;
    } else {
      places = await fetchNearbyPlaces(user.lat, user.lon);
      placesCache.set(cacheKey, { data: places, timestamp: Date.now() });
    }
  }
  aiContext.places = places;

  let suggestions = fallbackSuggestions(aiContext.friends, aiContext.user);

  if (aiHookConfigured()) {
    // Fetch User History from Amplitude
    let history = [];
    let ampContext = null;
    const ampCacheKey = userId;
    const cachedAmp = amplitudeCache.get(ampCacheKey);

    if (cachedAmp && Date.now() - cachedAmp.timestamp < AMP_CACHE_TTL) {
      ampContext = cachedAmp.data;
    } else {
      ampContext = await fetchAmplitudeUserContext(userId, { limit: 1000 });
      if (ampContext) {
        amplitudeCache.set(ampCacheKey, {
          data: ampContext,
          timestamp: Date.now(),
        });
      }
    }

    if (ampContext && ampContext.events) {
      history = ampContext.events
        .filter((e) => e.eventType === "suggestion_decision")
        .slice(0, 15)
        .map((e) => ({
          decision: e.eventProperties.decision,
          label: e.eventProperties.label,
          venue: e.eventProperties.venue,
          time: e.time,
        }));
    }

    console.log(
      `Calling AI Hook with ${history.length} history items for personalization...`,
    );

    try {
      const aiResponse = await callAIHook({
        type: "page_suggestions",
        context: { ...aiContext, history },
      });

      if (aiResponse?.suggestions?.length) {
        suggestions = aiResponse.suggestions;
      }
    } catch (err) {
      console.error("AI call failed, using fallbacks:", err);
    }
  }

  // 3. Update Cache
  suggestionsCache.set(userId, {
    suggestions,
    context: aiContext,
    timestamp: Date.now(),
  });

  return { suggestions, context: aiContext, fromCache: false };
}

async function prefetchAll() {
  if (!aiHookConfigured()) {
    console.log("Skipping prefetch: AI not configured.");
    return;
  }

  console.log("Orbit Suggestion Engine: Starting startup prefetch...");
  try {
    // Find users who have updated their location recently-ish (e.g., last 30 days)
    // or just all users for MVP since userbase is small.
    // Let's filter slightly to avoid dormant accounts if any.
    const activeUsers = await User.find({
      lat: { $exists: true },
      lon: { $exists: true }, // Must have location
    });

    console.log(`Found ${activeUsers.length} users for prefetching.`);

    for (const user of activeUsers) {
      // Run sequentially to avoid rate limiting or overwhelming local resource
      try {
        await getSuggestions(user, true); // Force refresh
        console.log(`Prefetched for user: ${user.email}`);
      } catch (e) {
        console.error(`Failed to prefetch for ${user.email}:`, e.message);
      }
    }
    console.log("Orbit Suggestion Engine: Prefetch complete.");
  } catch (err) {
    console.error("Error during prefetch:", err);
  }
}

module.exports = { getSuggestions, prefetchAll };
