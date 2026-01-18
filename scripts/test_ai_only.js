require("dotenv").config();
const { callAIHook, aiHookConfigured } = require("../utils/aiHook");

async function run() {
  console.log("--- Testing Backboard AI Chain ---");
  if (!aiHookConfigured()) {
    console.warn("⚠️ AI Hook not configured.");
    return;
  }

  // Same payload layout as real app
  const payload = {
    context: {
      user: { location: { lat: 43.6532, lon: -79.3832 }, name: "User" },
      friends: [
        {
          name: "Alice",
          location: { lat: 43.654, lon: -79.382 },
          distanceKm: 0.2,
        },
        { name: "Bob", location: null, distanceKm: null },
      ],
      places: [
        { name: "Balzac's Coffee", type: "cafe", score: 5 },
        { name: "Royal Ontario Museum", type: "museum", score: 5 },
        { name: "Generic Park", type: "park", score: 2 },
      ],
    },
  };

  console.log("Sending context to AI Chain (Processor -> Formatter)...");
  const result = await callAIHook(payload);

  if (result && result.suggestions) {
    console.log("\n✅ Success! AI Chain returned valid JSON suggestions.");
    console.log(JSON.stringify(result.suggestions, null, 2));
  } else {
    console.error("\n❌ AI Chain failed.");
  }
}

run();
