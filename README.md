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

## What this starter includes

- Live WebSocket connection
- Shared arena with connected players
- Movement using `WASD` or arrow keys
- A clean base to add rooms, matchmaking, combat, scores, or game rules
