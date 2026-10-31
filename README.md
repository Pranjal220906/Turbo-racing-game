# Turbo Racing Multiplayer

## Requirements
- Node.js 18 or newer
- A code editor such as VS Code

## Run locally
1. Extract this folder.
2. Open a terminal in this folder.
3. Run: `npm install`
4. Run: `npm start`
5. Open `http://localhost:3000` in your browser.
6. Open another browser tab or another device on the same network to test joining.

For a second device on the same Wi-Fi, use your computer's local IP address:
`http://YOUR-COMPUTER-IP:3000`

## Online deployment
### Backend on Render
1. Push this project to a GitHub repository.
2. In Render, create a new Web Service and connect the repository.
3. Set Build Command to `npm install`.
4. Set Start Command to `npm start`.
5. Deploy and copy the Render service URL, e.g. `https://your-game.onrender.com`.

### Frontend
This starter serves the frontend from the same Node.js service, so you do not need a separate Netlify deployment. Open the Render URL to play online.

## Important
- Share the public Render URL and the room code with friends.
- The server currently allows up to 4 players per room.
- Race progress is based on driving distance, with 3 distance-based laps.
- This is a playable prototype, not a production anti-cheat system.
- For production, restrict Socket.IO CORS to your website domain, add reconnect handling, authentication/rate limits, and persistent player accounts.