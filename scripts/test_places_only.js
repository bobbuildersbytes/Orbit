const { fetchNearbyPlaces } = require("../utils/places");

async function run() {
  console.log("--- Testing Places Refactor ---");
  // Toronto coordinates
  const lat = 43.6532;
  const lon = -79.3832;

  console.log(`Querying for broader set of places around ${lat}, ${lon}...`);
  const places = await fetchNearbyPlaces(lat, lon, 500); // 500m radius

  console.log(`\nFinal Result Count: ${places.length}`);
  if (places.length > 0) {
    console.log("Top 3 Places (High Score First):");
    console.log(JSON.stringify(places.slice(0, 3), null, 2));

    // Check if we have social places
    const social = places.some((p) => p.score > 1);
    console.log(
      `\nHas social places (score > 1)? ${social ? "YES ✅" : "NO ❌"}`,
    );

    // Check if we have place types that were previously ignored
    console.log(
      "Sample types found:",
      [...new Set(places.map((p) => p.type))].slice(0, 5),
    );
  } else {
    console.error("❌ No places returned.");
  }
}

run();
