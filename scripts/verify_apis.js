require("dotenv").config();
const { fetchNearbyPlaces } = require("../utils/places");
const { callAIHook, aiHookConfigured } = require("../utils/aiHook");

async function testOverpass() {
  console.log("--- Testing Overpass API ---");
  // Coordinates for a known location (e.g., Times Square, NY) or just generic valid ones.
  // Using generic lat/lon doesn't matter much for functionality test,
  // but let's use a real coordinate to get results.
  // 43.6532° N, 79.3832° W (Toronto - inferred from context of "uofthacks")
  const lat = 43.6532;
  const lon = -79.3832;

  console.log(`Fetching places around ${lat}, ${lon}...`);
  const places = await fetchNearbyPlaces(lat, lon, 500);

  if (places.length > 0) {
    console.log(`✅ Success! Found ${places.length} places.`);
    console.log("Sample:", places[0]);
    return true;
  } else {
    console.warn(
      "⚠️ No places found or API failed. (Check console for earlier errors)",
    );
    return false;
  }
}

async function testAI() {
  console.log("\n--- Testing AI Hook (Backboard/OpenAI) ---");
  if (!aiHookConfigured()) {
    console.warn(
      "⚠️ AI Hook not configured (missing AI_API_URL or AI_API_KEY).",
    );
    return false;
  }

  const payload = {
    context: {
      user: { location: { lat: 43.6532, lon: -79.3832 } },
      friends: [],
      places: [{ name: "Test Cafe", type: "cafe", lat: 43.65, lon: -79.38 }],
    },
  };

  console.log("Sending test prompt to AI...");
  const result = await callAIHook(payload);

  if (result && result.suggestions) {
    console.log("✅ Success! AI returned suggestions.");
    console.log("Sample suggestion:", result.suggestions[0]);
    return true;
  } else {
    console.error("❌ AI Hook failed or returned invalid format.");
    console.log("Result:", JSON.stringify(result, null, 2));
    return false;
  }
}

async function run() {
  const overpassOk = await testOverpass();
  const aiOk = await testAI();

  if (overpassOk && aiOk) {
    console.log("\n🎉 All API checks passed!");
  } else {
    console.log("\n⚠️ Some checks failed. See above.");
  }
}

run();
