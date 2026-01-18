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
async function backboardRequest(
  endpoint,
  method,
  body = null,
  isFormData = false,
) {
  const url = `${process.env.AI_API_URL}${endpoint}`;
  const headers = {
    "X-API-Key": process.env.AI_API_KEY,
  };

  if (!isFormData) {
    headers["Content-Type"] = "application/json";
  } else {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
  }

  const options = { method, headers };

  if (body) {
    if (isFormData) {
      options.body = new URLSearchParams(body).toString();
    } else {
      options.body = JSON.stringify(body);
    }
  }

  const res = await fetch(url, options);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Backboard API error (${res.status}): ${text}`);
  }

  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (err) {
    console.error("Backboard Response Parse Error. Raw Body:", text);
    throw new Error(`Failed to parse Backboard response: ${err.message}`);
  }
}

async function getOrCreateAssistant(type) {
  // ... (unchanged part of getOrCreateAssistant logic until the request)
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
      2. social: IF friends are nearby, ALWAYS prioritize meeting ONE specific friend per suggestion.
      3. specific: Do not suggest "friends" as a group. Suggest "Meet Alice" or "Meet Bob".
      4. time-aware: Notice the time. Suggest lunch for lunch, bars for night, etc.
      
      OUTPUT:
      Write a natural language summary of the location that does not contain the friend's name in it. For every suggestion, mention the SPECIFIC friend's ID if possible.
    `;
  } else {
    name = "Orbit JSON Formatter";
    prompt = `
      You are a strict JSON formatter.
      Take the provided social plan/summary and convert it into a strict JSON object.
      
      output format:
      Return a JSON object with a "suggestions" array.
      Each suggestion must have: type, label, detail, reason, actionLabel, and data.
      
      CRITICAL FORMATTING RULES:
      1. Label (Title): MUST be in the format "[Activity] at [Place] with [Person]".
         Example: "Coffee at Starbucks with Alice" or "Dinner at The Fox with Bob".
      2. Detail (Description): MUST be a description of the location/venue itself. do not mention the person here.
      3. Reason (Reasoning): The strategic reasoning for this suggestion.
      4. Action Label (Button): MUST be "Invite [First Name of Person]".
         Example: "Invite Alice".
      5. Data: 
         - "type": "activity_suggestion"
         - "userId": The friend's exact ID.
         - "venue": The name of the place.

      Example structure:
      "suggestions": [
        {{
          "type": "activity_suggestion",
          "label": "Coffee at Tyms with Alice",
          "detail": "A cozy cafe with great espresso...",
          "reason": "It is close to both of you.",
          "actionLabel": "Invite Alice",
          "data": {{ "userId": "123", "venue": "Tyms" }}
        }}
      ]
      
      RETURN ONLY JSON. NO MARKDOWN.
    `;
  }

  // Create new assistant
  console.log(`Creating Backboard assistant: ${name} (Default Model)...`);
  const data = await backboardRequest("/assistants", "POST", {
    name: name,
    system_prompt: prompt,
  });

  assistantCache[type] = data.assistant_id;
  return data.assistant_id;
}

async function runThread(assistantId, userContent) {
  // 1. Create Thread (JSON)
  const threadRes = await backboardRequest(
    `/assistants/${assistantId}/threads`,
    "POST",
    {},
  );
  const threadId = threadRes.thread_id;

  // 2. Send Message (Form Data)
  const msgRes = await backboardRequest(
    `/threads/${threadId}/messages`,
    "POST",
    {
      content:
        typeof userContent === "string"
          ? userContent
          : JSON.stringify(userContent),
    },
    true, // isFormData = true
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

    console.log("AI Raw Output:", jsonResponse);

    // Clean and Parse
    let cleaned = jsonResponse
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    // Attempt to find the JSON object if there's extra text
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      cleaned = jsonMatch[0];
    }

    return JSON.parse(cleaned);
  } catch (err) {
    console.error("AI Hook Chain Failed:", err.message);
    return null;
  }
}

module.exports = { aiHookConfigured, callAIHook };
