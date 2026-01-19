// Native fetch is used (Node 18+)

// Heuristics Model Configuration
const IGNORED_TYPES = new Set([
  "parking",
  "parking_space",
  "parking_entrance",
  "bicycle_parking",
  "waste_basket",
  "bench",
  "recycling",
  "vending_machine",
  "post_box",
  "telephone",
  "toilet",
  "toilets",
  "drinking_water",
  "atm",
  "fountain",
]);

const SOCIAL_PRIORITY = new Set([
  "cafe",
  "pub",
  "bar",
  "restaurant",
  "park",
  "museum",
  "cinema",
  "theatre",
  "nightclub",
  "library",
  "fitness_centre",
  "gym",
  "community_centre",
]);

/**
 * Filter and score places based on a simple heuristic model.
 * @param {Array} rawPlaces - Raw elements from Overpass
 * @returns {Array} - Sorted and filtered list of places
 */
function filterPlaces(rawPlaces) {
  return rawPlaces
    .filter((p) => {
      // 1. Must have a name
      if (!p.tags || !p.tags.name) return false;

      // Determine primary type
      const type =
        p.tags.amenity ||
        p.tags.leisure ||
        p.tags.shop ||
        p.tags.tourism ||
        p.tags.sport ||
        "unknown";

      // 2. Exclude ignored types
      if (IGNORED_TYPES.has(type)) return false;

      return true;
    })
    .map((p) => {
      const type =
        p.tags.amenity ||
        p.tags.leisure ||
        p.tags.shop ||
        p.tags.tourism ||
        p.tags.sport ||
        "place";
      // Determine location: node has lat/lon, way/relation has center (if using 'out center')
      const lat = p.lat || (p.center && p.center.lat);
      const lon = p.lon || (p.center && p.center.lon);

      // Simple scoring: High priority types get higher score
      let score = 1;
      if (SOCIAL_PRIORITY.has(type)) score = 5;
      if (type === "place") score = 0.5;

      return {
        name: p.tags.name,
        type: type,
        lat: lat,
        lon: lon,
        score: score,
        tags: p.tags, // Keep tags for debugging or advanced AI context if needed
      };
    })
    .sort((a, b) => b.score - a.score) // Sort by score descending
    .slice(0, 30); // Top 30
}

const placeCache = new Map();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

async function fetchNearbyPlaces(lat, lon, radius = 1000) {
  if (!lat || !lon) return [];

  // 1. Check Cache
  const cacheKey = `${lat.toFixed(3)},${lon.toFixed(3)},${radius}`;
  if (placeCache.has(cacheKey)) {
    const entry = placeCache.get(cacheKey);
    if (Date.now() - entry.timestamp < CACHE_TTL) {
      console.log("Using cached places for", cacheKey);
      return entry.data;
    }
  }

  // Broader Query: Get nodes, ways, and relations (nwr)
  // We use "nwr" instead of just "node" to catch parks (often ways), buildings, etc.
  // Optimized Broad Query:
  // 1. Find all nodes/ways/relations in radius -> store in .searchArea
  // 2. Filter .searchArea for specific tags
  const query = `
    [out:json][timeout:60];
    nwr(around:${radius},${lat},${lon})->.searchArea;
    (
      nwr.searchArea["amenity"];
      nwr.searchArea["leisure"];
      nwr.searchArea["shop"];
      nwr.searchArea["tourism"];
      nwr.searchArea["sport"];
      nwr.searchArea["historic"];
    );
    out center;
  `;

  try {
    const OVERPASS_INSTANCES = [
      "https://overpass-api.de/api/interpreter",
      "https://overpass.kumi.systems/api/interpreter",
      "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    ];

    const body = "data=" + encodeURIComponent(query);

    for (const url of OVERPASS_INSTANCES) {
      try {
        console.log(`Fetching places from Overpass (${url})...`);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 65000); // 65s local timeout (slightly > query timeout)

        const res = await fetch(url, {
          method: "POST",
          body: body,
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "OrbitApp/1.0 (uofthacks; contact@example.com)",
            Referer: "https://orbit-app.example.com",
          },
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (!res.ok) {
          console.warn(`Overpass error from ${url}: ${res.status}`);
          if (res.status === 504 || res.status === 502 || res.status === 429) {
            continue; // Try next mirror
          }
          break; // Stop on other errors (e.g. 400 Bad Request)
        }

        const data = await res.json();
        const rawElements = data.elements || [];
        console.log(
          `Fetched ${rawElements.length} raw items from Overpass. Filtering...`,
        );

        // Pass to local model/filter
        const places = filterPlaces(rawElements);
        console.log(`Model retained ${places.length} places.`);

        // 2. Set Cache
        placeCache.set(cacheKey, { timestamp: Date.now(), data: places });
        if (placeCache.size > 100) placeCache.clear();

        return places; // Success!
      } catch (err) {
        console.error(`Error fetching from ${url}:`, err.message);
        // Continue to next mirror on network error
      }
    }

    console.error("All Overpass instances failed.");
    return [];
  } catch (err) {
    console.error("Fatal error in place fetch:", err.message);
    return [];
  }
}

module.exports = { fetchNearbyPlaces };
