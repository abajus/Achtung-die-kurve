import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createGameServer } from '../server.js';

function nextMessage(socket, type) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { socket.off('message', listener); reject(new Error(`Timed out: ${type}`)); }, 3000);
    const listener = raw => {
      const data = JSON.parse(raw.toString());
      if (data.type === type) {
        clearTimeout(timeout);
        socket.off('message', listener);
        resolve(data);
      }
    };
    socket.on('message', listener);
  });
}

test('online room creation, joining, authority, starting, input, and host migration', async context => {
  const { server, sockets, rooms } = createGameServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = `ws://127.0.0.1:${server.address().port}`;
  const host = new WebSocket(address);
  const guest = new WebSocket(address);
  context.after(() => {
    host.terminate();
    guest.terminate();
    sockets.close();
    server.close();
  });
  await Promise.all([once(host, 'open'), once(guest, 'open')]);
  const joinedHost = nextMessage(host, 'joined');
  host.send(JSON.stringify({ type: 'create', name: 'Host' }));
  const { code, id: hostId } = await joinedHost;
  assert.match(code, /^[A-Z2-9]{5}$/);
  const joinedGuest = nextMessage(guest, 'joined');
  guest.send(JSON.stringify({ type: 'join', code, name: 'Guest' }));
  const { id: guestId } = await joinedGuest;
  const lobby = nextMessage(host, 'lobby');
  host.send(JSON.stringify({ type: 'settings', bots: 0, settings: { target: 5, speed: 150 } }));
  await lobby;
  guest.send(JSON.stringify({ type: 'start' }));
  const state = nextMessage(guest, 'state');
  host.send(JSON.stringify({ type: 'start' }));
  const snapshot = await state;
  assert.equal(snapshot.players.length, 2);
  assert.equal(snapshot.phase, 'countdown');
  guest.send(JSON.stringify({ type: 'input', turn: 999 }));
  const update = nextMessage(guest, 'state');
  guest.send(JSON.stringify({ type: 'input', turn: -1 }));
  await update;
  assert.equal(rooms.get(code).game.players.find(player => player.id === guestId).input, -1);
  const migrated = nextMessage(guest, 'lobby');
  host.close();
  assert.equal((await migrated).host, guestId);
  assert.equal(rooms.get(code).game.players.find(player => player.id === hostId).bot, true);
});