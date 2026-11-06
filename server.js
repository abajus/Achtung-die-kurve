import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { randomInt, randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { Game, STEP } from './public/engine.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const assets = {
  '/vendor/p5.js': 'node_modules/p5/lib/p5.min.js',
  '/vendor/matter.js': 'node_modules/matter-js/build/matter.min.js',
  '/vendor/lucide.js': 'node_modules/lucide/dist/umd/lucide.js',
};
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const cleanName = name => String(name || 'Player').trim().slice(0, 18) || 'Player';
const cleanSettings = settings => ({
  speed: [85, 115, 150, 185].includes(settings?.speed) ? settings.speed : 115,
  target: [5, 10, 15, 20].includes(settings?.target) ? settings.target : 10,
  gaps: settings?.gaps !== false,
});

export function createGameServer() {
  const rooms = new Map();
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    const pathname = decodeURIComponent(url.pathname);
    const filename = assets[pathname] ?? path.join('public', pathname === '/' ? 'index.html' : pathname);
    const absolute = path.resolve(root, filename);
    if (!absolute.startsWith(`${root}${path.sep}`) || (!assets[pathname] && !absolute.startsWith(`${root}/public/`))) {
      response.writeHead(403).end();
      return;
    }
    try {
      const content = await readFile(absolute);
      response.writeHead(200, {
        'Content-Type': `${types[path.extname(absolute)] ?? 'application/octet-stream'}; charset=utf-8`,
        'X-Content-Type-Options': 'nosniff',
      });
      response.end(content);
    } catch {
      response.writeHead(404).end('Not found');
    }
  });
  const sockets = new WebSocketServer({ server, maxPayload: 4096 });
  const send = (socket, data) => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(data));
  };
  const broadcast = (room, data) => room.members.forEach(member => send(member.socket, data));
  const lobby = room => broadcast(room, {
    type: 'lobby', code: room.code, host: room.host, settings: room.settings,
    players: room.members.map(({ id, name, slot }) => ({ id, name, slot })),
    bots: room.bots, playing: Boolean(room.game && room.game.phase !== 'match-over'),
  });
  const leave = socket => {
    const room = rooms.get(socket.roomCode);
    if (!room) return;
    room.members = room.members.filter(member => member.socket !== socket);
    if (!room.members.length) rooms.delete(room.code);
    else {
      if (room.host === socket.playerId) room.host = room.members[0].id;
      if (room.game) {
        const player = room.game.players.find(entry => entry.id === socket.playerId);
        if (player) { player.bot = true; player.input = 0; }
      }
      lobby(room);
    }
    socket.roomCode = null;
  };

  sockets.on('connection', socket => {
    socket.playerId = randomUUID();
    socket.lastMessage = Date.now();
    socket.messageCount = 0;
    socket.on('error', () => {});
    socket.on('message', raw => {
      if (Date.now() - socket.lastMessage > 1000) {
        socket.messageCount = 0;
        socket.lastMessage = Date.now();
      }
      if (++socket.messageCount > 120) return;
      let message;
      try { message = JSON.parse(raw.toString()); } catch { return; }
      if (!message || typeof message !== 'object') return;
      let room = rooms.get(socket.roomCode);
      if (message.type === 'create' || message.type === 'join') {
        if (message.type === 'create') {
          if (rooms.size >= 200) return send(socket, { type: 'error', message: 'Server is full. Try again shortly.' });
          let code;
          do { code = Array.from({ length: 5 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[randomInt(32)]).join(''); }
          while (rooms.has(code));
          leave(socket);
          room = { code, host: socket.playerId, members: [], bots: 1, settings: cleanSettings(message.settings) };
          rooms.set(code, room);
        } else {
          const destination = rooms.get(String(message.code).toUpperCase());
          if (!destination) return send(socket, { type: 'error', message: 'Room not found. Check the code.' });
          if (destination.members.length >= 6) return send(socket, { type: 'error', message: 'This room is full.' });
          if (destination.game && destination.game.phase !== 'match-over') {
            return send(socket, { type: 'error', message: 'A match is in progress. Join after it finishes.' });
          }
          leave(socket);
          room = destination;
        }
        const used = new Set(room.members.map(member => member.slot));
        const slot = [0, 1, 2, 3, 4, 5].find(value => !used.has(value));
        room.members.push({ id: socket.playerId, socket, name: cleanName(message.name), slot });
        room.bots = Math.min(room.bots, 6 - room.members.length);
        socket.roomCode = room.code;
        send(socket, { type: 'joined', id: socket.playerId, code: room.code });
        lobby(room);
        return;
      }
      if (!room) return;
      if (message.type === 'leave') return leave(socket);
      if (message.type === 'input' && room.game) {
        const player = room.game.players.find(entry => entry.id === socket.playerId);
        if (player && [-1, 0, 1].includes(message.turn)) player.input = message.turn;
      }
      if (socket.playerId !== room.host) return;
      if (message.type === 'settings' && (!room.game || room.game.phase === 'match-over')) {
        room.settings = cleanSettings(message.settings);
        if (Number.isInteger(message.bots)) room.bots = Math.max(0, Math.min(6 - room.members.length, message.bots));
        lobby(room);
      }
      if (message.type === 'start') {
        if (room.game && room.game.phase !== 'match-over') return;
        const players = room.members.map(({ id, name, slot }) => ({ id, name, slot }));
        const used = new Set(players.map(player => player.slot));
        for (const slot of [0, 1, 2, 3, 4, 5].filter(slot => !used.has(slot)).slice(0, room.bots)) {
          players.push({ id: `bot-${slot}`, name: `CPU ${slot + 1}`, slot, bot: true });
        }
        if (players.length < 2) return send(socket, { type: 'error', message: 'Add a bot or invite another player.' });
        room.game = new Game(players, room.settings);
        room.game.startRound();
        broadcast(room, { type: 'state', ...room.game.snapshot(true) });
      }
    });
    socket.on('close', () => leave(socket));
  });

  let tick = 0;
  let last = performance.now();
  let accumulator = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    accumulator += Math.min((now - last) / 1000, 0.15);
    last = now;
    while (accumulator >= STEP) {
      for (const room of rooms.values()) room.game?.step(STEP);
      accumulator -= STEP;
      tick++;
      if (tick % 3 === 0) {
        for (const room of rooms.values()) {
          if (room.game) broadcast(room, { type: 'state', ...room.game.snapshot() });
        }
      }
    }
  }, 8);
  timer.unref();
  server.on('close', () => clearInterval(timer));
  return { server, sockets, rooms };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { server } = createGameServer();
  const port = Number(process.env.PORT) || 3000;
  server.listen(port, '0.0.0.0', () => console.log(`Achtung, die Kurve! http://localhost:${port}`));
}