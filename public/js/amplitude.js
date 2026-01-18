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

  function identifyUser(user = {}, opts = {}) {
    if (!initialized || !window.amplitude) {
      if (!warnedNotReady) {
        console.warn("Amplitude not ready; cannot identify user yet.");
        warnedNotReady = true;
      }
      return;
    }

    const userId =
      user.uniqueId || user.id || user._id || user.email || "anonymous";
    window.amplitude.setUserId(String(userId));

    const identify = new window.amplitude.Identify();
    const name =
      user.name ||
      `${user.firstName || ""} ${user.lastName || ""}`.trim() ||
      undefined;
    const props = {
      userUniqueId: user.uniqueId,
      userMongoId: user._id || user.id,
      email: user.email,
      name,
      availability: opts.available ?? user.available,
      isBusy: opts.isBusy ?? user.isBusy,
      lastSeen: user.lastSeen,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };

    const location = opts.location || user.location;
    if (location && typeof location.lat === "number" && typeof location.lon === "number") {
      props.locationLat = location.lat;
      props.locationLon = location.lon;
    }

    Object.entries(props).forEach(([key, val]) => {
      if (val !== undefined && val !== null && val !== "") {
        identify.set(key, val);
      }
    });

    window.amplitude.identify(identify);
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

  return { initFromServer, track, identifyUser };
})();
