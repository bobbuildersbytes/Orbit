# My Node.js Web App

A simple web application built with Node.js, Express, HTML, CSS, and authentication via email/password with MongoDB.

## Getting Started

1. Install dependencies: `npm install`
2. Set up environment variables in `.env`:
   - Set MONGODB_URI to your MongoDB Atlas connection string.
   - Set SESSION_SECRET to a random string.
3. Start the server: `npm start`
4. Open your browser to `http://localhost:8008`
5. Sign up at `/signup`, then login at `/`

## Project Structure

- `server.js`: The main server file
- `public/`: Static files
  - `index.html`: Main HTML page
  - `css/style.css`: Stylesheet
  - `js/app.js`: Client-side JavaScript