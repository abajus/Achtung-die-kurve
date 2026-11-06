# Achtung, die Kurve!

A browser recreation of the classic curve-survival game, rendered with p5.js.

## Run

Requires Node.js 20 or newer.

```sh
npm install
npm start
```

Open http://localhost:3000. Set `PORT` to use a different port.

## Play

- Local multiplayer: 2-6 players sharing a keyboard. Click a key in the lineup to rebind it; change a player's type to CPU · Easy, Normal or Hard for a bot opponent.
- Default controls: Citron uses A/D, Rose uses Left/Right. Enter starts a match; Space or Escape pauses local play.
- Online multiplayer: create a room and share its invite link or five-character code. Each device uses Left/Right or A/D, or touch controls on mobile. The host sets the rules, the number of CPU players and their skill, and starts matches.
- Survive without touching walls or trails, including your own. Random gaps are openings in trails, not invulnerability. Earn one point per opponent you outlive. A match needs a unique leader at or above the target score.
- Rounds advance automatically. Scores reset for a new match. Sound is opt-in; fullscreen is available where supported.

## Connecting Friends

The server listens on all interfaces. For devices on the same Wi-Fi, open `http://<your-computer-LAN-IP>:3000` on each device. Share that address rather than localhost. Your firewall must permit incoming connections.

For friends outside your network, the Node server needs a publicly reachable host or tunnel that supports WebSockets. This project does not deploy itself. Use HTTPS/WSS for public hosting. Rooms are in memory and disappear when the server restarts. There are no accounts, room persistence, or reconnect/resume; disconnected players become bots, and players can rejoin after the current match finishes.

The server owns simulation, scoring, and inputs for online games. Local games use the same fixed-step engine. CPU players look ahead two turns, avoid the predicted paths of rivals, and prefer moves that leave the most reachable open space (counting their own planned trail as a wall, so they avoid pockets too tight to turn in). Easy reacts slowly with a short look-ahead; Hard reacts fastest and looks furthest. Matter.js provides collision geometry; trails use a spatial grid to limit collision candidates. Online snapshots are sent at 20 Hz with incremental trail updates.

## Tests

```sh
npm test
npx playwright install chromium
npm run test:browser
```

Unit and integration tests cover collisions, gaps, countdown, scoring, rooms, inputs, and host migration. Browser tests cover desktop rendering, local controls, pause/resume, mobile layout, touch input, and a two-client online match. Browser tests start their own server on port 3100; screenshots are saved in the ignored test-results directory.