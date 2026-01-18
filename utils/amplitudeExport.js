const AMPLITUDE_API_URL =
  process.env.AMPLITUDE_API_URL || "https://amplitude.com/api/2";

function amplitudeConfigured() {
  return Boolean(process.env.AMPLITUDE_API_KEY && process.env.AMPLITUDE_API_SECRET);
}

async function fetchAmplitudeUserContext(userId, opts = {}) {
  if (!amplitudeConfigured()) return null;
  if (!userId) return null;

  const { limit = 50 } = opts;
  const url = `${AMPLITUDE_API_URL}/useractivity?user=${encodeURIComponent(
    userId,
  )}&limit=${limit}`;

  const auth = Buffer.from(
    `${process.env.AMPLITUDE_API_KEY}:${process.env.AMPLITUDE_API_SECRET}`,
  ).toString("base64");

  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Basic ${auth}`,
      },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Amplitude responded ${res.status}: ${text}`);
    }
    const json = await res.json();

    const events =
      (json.events || []).map((e) => ({
        eventType: e.event_type,
        time: e.event_time,
        country: e.country,
        city: e.city,
        device: e.device,
        platform: e.platform,
        os: e.os,
        eventProperties: e.event_properties || {},
        userProperties: e.user_properties || {},
        locationLat: e.location_lat,
        locationLng: e.location_lng,
      })) || [];

    return {
      userId,
      userProperties: json.userData?.userProperties || {},
      events,
    };
  } catch (err) {
    console.error("Failed to fetch Amplitude user context:", err.message);
    return null;
  }
}

module.exports = { fetchAmplitudeUserContext, amplitudeConfigured };
