const AMPLITUDE_API_URL =
  process.env.AMPLITUDE_API_URL || "https://amplitude.com/api/2";

function amplitudeConfigured() {
  return Boolean(
    process.env.AMPLITUDE_API_KEY && process.env.AMPLITUDE_API_SECRET,
  );
}

async function resolveAmplitudeId(userId) {
  const url = `${AMPLITUDE_API_URL}/usersearch?user=${encodeURIComponent(
    userId,
  )}`;
  const auth = Buffer.from(
    `${process.env.AMPLITUDE_API_KEY}:${process.env.AMPLITUDE_API_SECRET}`,
  ).toString("base64");

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Basic ${auth}` },
    });
    if (!res.ok) return null;
    const json = await res.json();
    // API returns { matches: [ { amplitude_id: 123, ... } ] }
    if (json.matches && json.matches.length > 0) {
      return json.matches[0].amplitude_id;
    }
    return null;
  } catch (err) {
    console.error("Failed to resolve Amplitude ID:", err.message);
    return null;
  }
}

async function fetchAmplitudeUserContext(userId, opts = {}) {
  if (!amplitudeConfigured()) return null;
  if (!userId) return null;

  // 1. Resolve to Amplitude integer ID if it's a string
  let amplitudeId = userId;
  if (typeof userId !== "number") {
    amplitudeId = await resolveAmplitudeId(userId);
    if (!amplitudeId) {
      console.log(
        `Amplitude context: User ${userId} not found (no history). Skipping personalization.`,
      );
      return null;
    }
  }

  const { limit = 50, types } = opts;
  let url = `${AMPLITUDE_API_URL}/useractivity?user=${amplitudeId}&limit=${limit}`;

  if (types && Array.isArray(types) && types.length > 0) {
    // Amplitude expects a JSON array for types
    url += `&types=${encodeURIComponent(JSON.stringify(types))}`;
  }

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
        eventProperties: e.event_properties || {},
        userProperties: e.user_properties || {},
        // ... (other fields as needed)
      })) || [];

    // DEBUG: Log unique event types found to confirm we are seeing data
    const types = [...new Set(events.map((e) => e.eventType))];
    console.log(
      `DEBUG: Amplitude returned ${events.length} events. Types:`,
      types,
    );
    if (events.length > 0) {
      console.log("DEBUG: Sample event:", JSON.stringify(events[0], null, 2));
    }

    return {
      userId,
      amplitudeId,
      userProperties: json.userData?.userProperties || {},
      events,
    };
  } catch (err) {
    console.error("Failed to fetch Amplitude user context:", err.message);
    return null;
  }
}

module.exports = { fetchAmplitudeUserContext, amplitudeConfigured };
