// Lightweight AI hook wrapper so teammates can plug in any HTTP AI endpoint.
// Set AI_API_URL and AI_API_KEY in your environment to enable.

function aiHookConfigured() {
  return Boolean(process.env.AI_API_URL && process.env.AI_API_KEY);
}

async function callAIHook(payload) {
  if (!aiHookConfigured()) return null;

  if (typeof fetch !== "function") {
    console.warn(
      "AI hook skipped: global fetch not available. Upgrade Node to v18+ or install node-fetch.",
    );
    return null;
  }

  try {
    const res = await fetch(process.env.AI_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.AI_API_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text();
      console.warn("AI hook responded with non-OK status:", res.status, text);
      return null;
    }

    const data = await res.json();
    return data;
  } catch (err) {
    console.error("AI hook failed:", err);
    return null;
  }
}

module.exports = { aiHookConfigured, callAIHook };
