// Replace with your Amplitude Browser API Key (not the secret key).
// If your project is in the EU data center, set SERVER_ZONE to "EU".
const CONFIG = {
  API_KEY: "d1fc1c9c8d13e32e0719155451fbebcc",
  SERVER_ZONE: "US",
};

window.amplitudeClient = (function () {
  let initialized = false;
  let warnedNotReady = false;

  async function initFromServer() {
    if (initialized) return;
    try {
      // In a real scenario, we might fetch the key from the server if not hardcoded
      // const res = await fetch('/api/config/amplitude');
      // const data = await res.json();
      // const key = data.apiKey;

      if (window.amplitude) {
        window.amplitude.init(
          CONFIG.API_KEY,
          undefined,
          {
            defaultTracking: {
              sessions: true,
              pageViews: true,
              formInteractions: true,
              fileDownloads: true,
            },
            serverZone: CONFIG.SERVER_ZONE === "EU" ? "EU" : "US",
          },
        );
        initialized = true;
        console.log("Amplitude initialized");
      } else {
        console.warn("Amplitude SDK not loaded; events will be dropped");
      }
    } catch (err) {
      console.error("Amplitude init failed", err);
    }
  }

  function track(event, properties = {}) {
    if (!initialized || !window.amplitude) {
      if (!warnedNotReady) {
        console.warn("Amplitude not ready; dropping events. Check API key and SDK load.");
        warnedNotReady = true;
      }
      return;
    }
    window.amplitude.track(event, properties);
  }

  return { initFromServer, track };
})();
