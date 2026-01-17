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
