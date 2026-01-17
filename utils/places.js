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

async function fetchNearbyPlaces(lat, lon, radius = 1000) {
  if (!lat || !lon) return [];

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
    const url = "https://overpass-api.de/api/interpreter";
    const body = "data=" + encodeURIComponent(query);

    console.log("Fetching places from Overpass (Broad Query)...");
    const res = await fetch(url, {
      method: "POST",
      body: body,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "OrbitApp/1.0 (uofthacks; contact@example.com)",
        Referer: "https://orbit-app.example.com",
      },
    });

    if (!res.ok) {
      console.warn("Overpass API error:", res.status);
      return [];
    }

    const data = await res.json();
    const rawElements = data.elements || [];
    console.log(
      `Fetched ${rawElements.length} raw items from Overpass. Filtering...`,
    );

    // Pass to local model/filter
    const places = filterPlaces(rawElements);
    console.log(`Model retained ${places.length} places.`);

    return places;
  } catch (err) {
    console.error("Error fetching places:", err.message);
    return [];
  }
}

module.exports = { fetchNearbyPlaces };
