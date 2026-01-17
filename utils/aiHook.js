// Backboard.io AI Hook
// Implements a 2-step chain: Context Processor -> JSON Formatter

let assistantCache = {
  processor: null,
  formatter: null,
};

function aiHookConfigured() {
  return Boolean(process.env.AI_API_URL && process.env.AI_API_KEY);
}

// Helper for HTTP requests to Backboard
async function backboardRequest(endpoint, method, body = null) {
  const url = `${process.env.AI_API_URL}${endpoint}`;
  const headers = {
    "Content-Type": "application/json",
    "X-API-Key": process.env.AI_API_KEY,
  };

  const options = { method, headers };
  if (body) options.body = JSON.stringify(body);

  const res = await fetch(url, options);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Backboard API error (${res.status}): ${text}`);
  }
  return res.json();
}

async function getOrCreateAssistant(type) {
  if (assistantCache[type]) return assistantCache[type];

  let name, prompt;
  if (type === "processor") {
    name = "Orbit Context Processor";
    prompt = `
      You are an expert social planner for the generic "Orbit" app.
      Analyze the provided JSON context (User, location, friends, nearby places).
      Identify 3-5 specific, high-quality opportunities for the user to socialize or do an activity.
      
      RULES:
      1. detailed: Look at the "places" list. Pick valid, named places.
      2. social: IF friends are nearby (low distance), prioritizing meeting them.
      3. time-aware: Notice the time. Suggest lunch for lunch, bars for night, etc.
      
      OUTPUT:
      Write a natural language summary of your best ideas. Explain WHY you picked them.
    `;
  } else {
    name = "Orbit JSON Formatter";
    prompt = `
      You are a strict JSON formatter.
      Take the provided social plan/summary and convert it into a strict JSON object.
      
      output format:
      {
        "suggestions": [
          {
            "type": "page_friend" | "activity_suggestion",
            "label": "Short Title",
            "detail": "Time/Place details",
            "reason": "Why this was suggested",
            "actionLabel": "Button Label",
            "data": { "userId": "..." } OR { "activity": "...", "location": "..." }
          }
        ]
      }
      
      RETURN ONLY JSON. NO MARKDOWN.
    `;
  }

  // Select best model for the task
  const model =
    type === "processor" ? "anthropic/claude-3.5-sonnet" : "openai/gpt-4o";

  // Create new assistant
  console.log(`Creating Backboard assistant: ${name} (Model: ${model})...`);
  const data = await backboardRequest("/assistants", "POST", {
    name: name,
    system_prompt: prompt,
    model: model,
  });

  assistantCache[type] = data.assistant_id;
  return data.assistant_id;
}

async function runThread(assistantId, userContent) {
  // 1. Create Thread
  const threadRes = await backboardRequest(
    `/assistants/${assistantId}/threads`,
    "POST",
    {},
  );
  const threadId = threadRes.thread_id;

  // 2. Send Message
  const msgRes = await backboardRequest(
    `/threads/${threadId}/messages`,
    "POST",
    {
      content:
        typeof userContent === "string"
          ? userContent
          : JSON.stringify(userContent),
      stream: "false",
      memory: "Auto", // Per documentation/example
    },
  );

  return msgRes.content;
}

async function callAIHook(payload) {
  if (!aiHookConfigured()) return null;

  try {
    // --- Step 1: Context Processing ---
    console.log("AI Step 1: Processing Context...");
    const processorId = await getOrCreateAssistant("processor");
    const processorResponse = await runThread(processorId, payload);
    console.log(
      "AI Processor Output (Partial):",
      processorResponse.substring(0, 100) + "...",
    );

    // --- Step 2: JSON Formatting ---
    console.log("AI Step 2: Formatting to JSON...");
    const formatterId = await getOrCreateAssistant("formatter");
    const jsonResponse = await runThread(formatterId, processorResponse);

    // Clean and Parse
    const cleaned = jsonResponse
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    return JSON.parse(cleaned);
  } catch (err) {
    console.error("AI Hook Chain Failed:", err.message);
    return null;
  }
}

module.exports = { aiHookConfigured, callAIHook };
