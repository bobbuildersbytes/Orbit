const CONFIG = {
  API_KEY: "d1fc1c9c8d13e32e0719155451fbebcc", // Public key, safe to expose
};

window.amplitudeClient = (function () {
  let initialized = false;

  async function initFromServer() {
    if (initialized) return;
    try {
      // In a real scenario, we might fetch the key from the server if not hardcoded
      // const res = await fetch('/api/config/amplitude');
      // const data = await res.json();
      // const key = data.apiKey;

      if (window.amplitude) {
        window.amplitude.init(CONFIG.API_KEY, {
          defaultTracking: {
            sessions: true,
            pageViews: true,
            formInteractions: true,
            fileDownloads: true,
          },
        });
        initialized = true;
        console.log("Amplitude initialized");
      }
    } catch (err) {
      console.error("Amplitude init failed", err);
    }
  }

  function track(event, properties = {}) {
    if (!initialized || !window.amplitude) {
      // Buffer or ignore
      // console.log('Amplitude not ready, event:', event);
      return;
    }
    window.amplitude.track(event, properties);
  }

  return { initFromServer, track };
})();
