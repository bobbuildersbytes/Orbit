# My Node.js Web App

A simple web application built with Node.js, Express, HTML, CSS, and authentication via email/password with MongoDB.

## Getting Started

1. Install dependencies: `npm install`
2. Set up environment variables in `.env`:
   - Set MONGODB_URI to your MongoDB Atlas connection string.
   - Set SESSION_SECRET to a random string.
   - (Optional) Set EMAIL_USER / EMAIL_PASS for pager emails.
   - (Optional) Set AI_API_URL / AI_API_KEY to enable AI-driven paging suggestions.
3. Start the server: `npm start`
4. Open your browser to `http://localhost:8008`
5. Sign up at `/signup`, then login at `/`

## Project Structure

- `server.js`: The main server file
- `public/`: Static files
  - `index.html`: Main HTML page
  - `css/style.css`: Stylesheet
  - `js/app.js`: Client-side JavaScript

## Paging telemetry + AI hook

- Every page action is logged to `models/PageEvent.js` with sender, receiver, message, status (`sent`/`accepted`), and timestamps. The `/pager` endpoint now returns JSON when called with `Content-Type: application/json` (used by the frontend).
- Acceptance tracking: the paged user can acknowledge a page by POSTing to `/api/page-events/:id/accept` while authenticated (only the `toUser` can accept). This feeds acceptance-rate metrics.
- Context builder: `/api/suggestions/context` now returns rich context plus suggestions. The context includes:
  - `user`: availability/busy flags, location (if shared)
  - `friends[]`: availability/busy flags, last seen (minutes ago), lat/lon, distance from user (km), and `pageHistory` (total, accepted, acceptanceRate %, lastPageAt).
- AI hook:
  - Set `AI_API_URL` and `AI_API_KEY` to enable; otherwise fallback heuristics are used.
  - Payload sent to your AI endpoint: `{ type: "page_suggestions", context }` where `context` is described above.
  - Expected AI response shape: `{ suggestions: [{ type, label, reason, data? }] }`. Known `type` values today: `page_friend` (use `data.userId`), `go_available`, `go_busy`.
  - The server will use AI suggestions when present; otherwise it auto-suggests the top available/busy-friendly friends ranked by acceptance rate, distance, and freshness.

### Quick examples

- Fetch context + suggestions (as the logged-in user):
  ```bash
  curl -H "Cookie: connect.sid=..." http://localhost:8008/api/suggestions/context
  ```
- Accept a page (mark as responded):
  ```bash
  curl -X POST -H "Cookie: connect.sid=..." http://localhost:8008/api/page-events/<pageEventId>/accept
  ```
- AI endpoint contract (if you host one):
  - Input: `{ type: "page_suggestions", context: { ...see above... } }`
  - Output: `{ suggestions: [{ type: "page_friend", label: "Page Jane", reason: "Close by + high response rate", data: { userId: "<friendId>" } }] }`
- Client-side AI hook (optional UI trigger): from a custom script you can call `suggestionsUI.suggestPage({ label, detail, data: { userId } })` to open the confirmation modal and let the user send a page. It will preselect the provided `userId` when available, otherwise offer the closest available friends. The UI never auto-sends; the user must click “Page”.

## Amplitude identity and AI data tap

- The browser now calls `amplitudeClient.identifyUser` on load, presence change, and after the first location update. Amplitude `user_id` is set to `user.uniqueId` (falls back to Mongo `_id`/email) and traits include `userMongoId`, `email`, `name`, `availability`, `isBusy`, `lastSeen`, `timeZone`, and `locationLat`/`locationLon` when shared.
- Events already carry useful context: `presence_updated`/`page_clicked` include hour/day metadata; `location_sent` ships lat/lon; suggestion clicks are logged via `suggestion_clicked`.
- To feed Amplitude history into your AI agent, query Amplitude by `user_id` (the Orbit `uniqueId`) using the Export API or a dashboard query, then pass that history into the AI hook alongside `/api/suggestions/context`. Example export call:  
  `curl -u YOUR_API_KEY:YOUR_SECRET "https://amplitude.com/api/2/export?start=20240101T00&end=20240102T00&user_id=abcd1234"`  
  The JSON rows include the user traits above plus event payloads you can hydrate into the AI input.
- Suggested AI payload pattern: `{ type: "page_suggestions", context: <Orbit context>, amplitude: { userId: "<uniqueId>", events: [...], userProperties: {...} } }`. This lets the agent reason over location, venue types, time/day, availability patterns, and past responses in one place.
