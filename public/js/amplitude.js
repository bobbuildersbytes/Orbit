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
      const res = await fetch("/api/config");
      if (!res.ok) throw new Error("Failed to load config");
      const data = await res.json();
      const key = data.amplitudeApiKey || CONFIG.API_KEY;

      if (window.amplitude && key) {
        console.log(
          "Amplitude: Initialized with key",
          key.substring(0, 5) + "...",
        );
        window.amplitude.init(key, undefined, {
          defaultTracking: {
            sessions: true,
            pageViews: true,
            formInteractions: true,
            fileDownloads: true,
          },
          logLevel: "INFO",
          serverZone: CONFIG.SERVER_ZONE === "EU" ? "EU" : "US",
        });
        initialized = true;
      } else {
        console.warn("Amplitude SDK not loaded or key missing", {
          hasAmplitude: !!window.amplitude,
          hasKey: !!key,
          keyVal: key ? "Present" : "Missing",
        });
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
      user._id || user.id || user.uniqueId || user.email || "anonymous";
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
    if (
      location &&
      typeof location.lat === "number" &&
      typeof location.lon === "number"
    ) {
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
        console.warn(
          "Amplitude not ready; dropping events. Check API key and SDK load.",
        );
        warnedNotReady = true;
      }
      return;
    }
    try {
      if (typeof window.amplitude.logEvent === "function") {
        window.amplitude.logEvent(event, properties);
      } else if (typeof window.amplitude.track === "function") {
        window.amplitude.track(event, properties);
      } else {
        console.warn("Amplitude: Neither logEvent nor track is available");
      }
    } catch (e) {
      console.error("Amplitude Wrapper: Track failed exception", e);
    }
  }

  return { initFromServer, track, identifyUser };
})();
