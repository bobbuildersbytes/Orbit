// Generic AI hook for OpenAI-compatible providers (like Backboard.io / OpenRouter)
// Set AI_API_URL, AI_API_KEY, and AI_MODEL in .env

function aiHookConfigured() {
  return Boolean(process.env.AI_API_URL && process.env.AI_API_KEY);
}

async function callAIHook(payload) {
  if (!aiHookConfigured()) return null;

  try {
    const prompt = `
      You are an AI assistant for a social app called Orbit. 
      Your goal is to suggest relevant actions for the user based on their context and their friends' status.
      
      Context:
      ${JSON.stringify(payload.context, null, 2)}
      
      Task:
      Generate 3 to 5 distinct suggestions for the user.
      Each suggestion must have:
      - type: String (e.g., "page_friend", "set_status", "view_map")
      - label: String (Short, action-oriented text, e.g., "Page Alice")
      - reason: String (Why this is suggested, e.g., "Alice is nearby and available")
      - data: Object (Optional, e.g., { userId: "..." } for friend actions)

      For "page_friend" type, you must include "data": { "userId": "<friend_id>" }.
      Only suggest paging friends who are available and not busy.
      
      Response Format:
      Return strictly a JSON object with a single key "suggestions" containing the array. 
      Do not include markdown formatting.
    `;

    const body = {
      model: process.env.AI_MODEL || "google/gemini-2.5-flash-lite",
      messages: [
        {
          role: "system",
          content: "You are a helpful assistant that outputs only JSON.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.7,
      // response_format: { type: "json_object" } // Generic providers might not support this, optional
    };

    const res = await fetch(`${process.env.AI_API_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.AI_API_KEY}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      console.warn("AI hook responded with non-OK status:", res.status, text);
      return null;
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) return null;

    // Clean up if there are markdown code blocks just in case
    const cleanedText = content
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    return JSON.parse(cleanedText);
  } catch (err) {
    console.error("AI hook failed:", err);
    return null;
  }
}

module.exports = { aiHookConfigured, callAIHook };
