# Multiplayer React + Node Starter

A minimal starter for an online multiplayer game using:

- React + Vite for the client
- Node.js + Express for the backend
- WebSockets (`ws`) for real-time game state

## Quick start

1. Install dependencies:

   ```bash
   npm install
   ```

2. Start the client and server together:

   ```bash
   npm run dev
   ```

3. Open http://localhost:5173 in two browser tabs.

## Project structure

- `src/`: React client
- `server/`: Node.js multiplayer server

## Deploy on Render

This project is ready to deploy to Render as a single `Web Service`.

1. Push this repository to GitHub.

2. Sign in to Render and choose `New` -> `Blueprint`.

3. Connect your GitHub account and select this repository.

4. Render will detect [`render.yaml`](C:\Users\16503\Main\my-first-vibe-coding\render.yaml) and create the service automatically.

5. Confirm the deploy.

The included Render blueprint uses:

- Build command: `npm install && npm run build`
- Start command: `npm start`

After the deploy finishes, Render will give you a public `onrender.com` URL that serves both:

- the React frontend
- the Node.js + WebSocket multiplayer server

### Notes

- Room URLs work in production too, for example `/ABCD`.
- WebSockets are configured to use the same site origin in production.
- The server already listens on Render's `PORT` environment variable.

## What this starter includes

- Live WebSocket connection
- Shared arena with connected players
- Movement using `WASD` or arrow keys
- A clean base to add rooms, matchmaking, combat, scores, or game rules
