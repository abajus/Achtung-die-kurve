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