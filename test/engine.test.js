import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, WIDTH, STEP } from '../public/engine.js';

const makeGame = settings => {
  const game = new Game([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], settings, () => 0.5);
  game.startRound();
  game.phase = 'playing';
  return game;
};

test('countdown holds positions until the round starts', () => {
  const game = makeGame();
  game.phase = 'countdown';
  const start = game.players[0].x;
  for (let index = 0; index < 181; index++) game.step();
  assert.equal(game.phase, 'playing');
  assert.equal(game.players[0].x, start);
});

test('wall collision awards the survivor a point and ends the round', () => {
  const game = makeGame();
  Object.assign(game.players[0], { x: WIDTH - 3, angle: 0 });
  game.step();
  assert.equal(game.players[0].alive, false);
  assert.equal(game.players[1].score, 1);
  assert.equal(game.phase, 'round-over');
});

test('swept movement detects a thin trail at maximum speed', () => {
  const game = makeGame({ speed: 200 });
  const [first, second] = game.players;
  Object.assign(second, { x: 200, y: 220 });
  game.addSegment(second, 200, 180);
  Object.assign(first, { x: 195, y: 200, angle: 0 });
  game.step();
  assert.equal(first.alive, false);
});

test('gaps do not add trail segments but still collide with walls', () => {
  const game = makeGame();
  Object.assign(game.players[0], { gap: true, gapAt: 1 });
  game.step();
  assert.equal(game.segments.length, 1);
  Object.assign(game.players[0], { x: WIDTH - 3, angle: 0 });
  game.step();
  assert.equal(game.players[0].alive, false);
});

test('target score ends the match and snapshots drain only deltas', () => {
  const game = makeGame({ target: 1 });
  Object.assign(game.players[0], { x: WIDTH - 3, angle: 0 });
  game.step(STEP);
  assert.equal(game.phase, 'match-over');
  assert.equal(game.winner, 'b');
  assert.ok(game.snapshot().segments.length);
  assert.equal(game.snapshot().segments.length, 0);
  assert.ok(game.snapshot(true).segments.length);
});
test('bots of every level steer away from a wall ahead', () => {
  for (const level of ['easy', 'normal', 'hard']) {
    const game = new Game([{ id: 'a', bot: true, level }, { id: 'b' }], {}, () => 0.9);
    game.startRound();
    game.phase = 'playing';
    Object.assign(game.players[0], { x: WIDTH - 60, y: 380, angle: 0 });
    Object.assign(game.players[1], { x: 100, y: 100, angle: Math.PI / 2 });
    for (let index = 0; index < 60; index++) game.step();
    assert.equal(game.players[0].alive, true, `${level} bot hit the wall`);
  }
});

test('normal bot steers away from a pocket too tight to turn around in', () => {
  const game = new Game([{ id: 'a', bot: true, level: 'normal' }, { id: 'b' }], { gaps: false }, () => 0.9);
  game.startRound();
  game.phase = 'playing';
  const wall = { id: 'w', color: '#000' };
  const draw = (x1, y1, x2, y2) => {
    const steps = Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 3);
    for (let index = 0; index < steps; index++) {
      Object.assign(wall, { x: x1 + (x2 - x1) * (index + 1) / steps, y: y1 + (y2 - y1) * (index + 1) / steps });
      game.addSegment(wall, x1 + (x2 - x1) * index / steps, y1 + (y2 - y1) * index / steps);
    }
  };
  // A 70px box straight ahead with a 30px mouth: the bot's own trail would seal it in.
  draw(500, 325, 570, 325); draw(570, 325, 570, 395); draw(570, 395, 500, 395); draw(500, 395, 500, 375); draw(500, 345, 500, 325);
  Object.assign(game.players[0], { x: 440, y: 360, angle: 0 });
  Object.assign(game.players[1], { x: 100, y: 700, angle: Math.PI });
  game.players[0].input = game.botInput(game.players[0]);
  assert.notEqual(game.players[0].input, 0);
});
