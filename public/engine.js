import Matter from 'matter-js';

export const WIDTH = 1200;
export const HEIGHT = 760;
export const COLORS = ['#eaff63', '#fa7394', '#68d8ee', '#bd9bff', '#ffae70', '#78e2a1'];
export const NAMES = ['Citron', 'Rose', 'Glacier', 'Lilac', 'Tangerine', 'Mint'];
export const STEP = 1 / 60;

export class Game {
  constructor(players, settings = {}, random = Math.random) {
    this.random = random;
    this.settings = { speed: 115, gaps: true, target: 10, ...settings };
    this.players = players.map((player, index) => ({
      ...player, color: COLORS[player.slot ?? index], score: 0, input: 0,
    }));
    this.round = 0;
    this.phase = 'ready';
    this.segments = [];
    this.pending = [];
    this.grid = new Map();
    this.tick = 0;
  }

  startRound() {
    this.round++;
    this.phase = 'countdown';
    this.timer = 3;
    this.tick = 0;
    this.segments = [];
    this.pending = [];
    this.grid.clear();
    this.winner = null;
    this.players.forEach((player, index) => {
      const angle = index * Math.PI * 2 / this.players.length + this.random() * 0.3;
      Object.assign(player, {
        x: WIDTH / 2 + Math.cos(angle) * WIDTH * 0.27,
        y: HEIGHT / 2 + Math.sin(angle) * HEIGHT * 0.27,
        angle: angle + Math.PI + (this.random() - 0.5) * 0.8,
        alive: true, input: 0, distance: 0, gap: false,
        gapAt: 1.5 + this.random() * 2.5,
      });
    });
  }

  cellKey(x, y) { return `${Math.floor(x / 24)},${Math.floor(y / 24)}`; }

  addSegment(player, fromX, fromY) {
    const segment = { x1: fromX, y1: fromY, x2: player.x, y2: player.y, color: player.color };
    this.segments.push(segment);
    this.pending.push(segment);
    const length = Math.hypot(player.x - fromX, player.y - fromY);
    const body = Matter.Bodies.rectangle((fromX + player.x) / 2, (fromY + player.y) / 2, length + 3, 3, {
      angle: Math.atan2(player.y - fromY, player.x - fromX), isStatic: true,
    });
    const entry = { body, playerId: player.id, tick: this.tick };
    const keys = new Set();
    for (let cellX = Math.floor((body.bounds.min.x - 3) / 24); cellX <= Math.floor((body.bounds.max.x + 3) / 24); cellX++) {
      for (let cellY = Math.floor((body.bounds.min.y - 3) / 24); cellY <= Math.floor((body.bounds.max.y + 3) / 24); cellY++) {
        keys.add(`${cellX},${cellY}`);
      }
    }
    for (const key of keys) {
      if (!this.grid.has(key)) this.grid.set(key, []);
      this.grid.get(key).push(entry);
    }
  }

  blocked(player, x, y) {
    if (x < 3 || x > WIDTH - 3 || y < 3 || y > HEIGHT - 3) return true;
    const head = Matter.Bodies.circle(x, y, 2.5);
    const candidates = this.grid.get(this.cellKey(x, y)) ?? [];
    return candidates.some(entry => {
      if (entry.playerId === player.id && this.tick - entry.tick < 12) return false;
      return Boolean(Matter.Collision.collides(head, entry.body));
    });
  }

  botInput(player) {
    const options = [-1, 0, 1].map(input => {
      let x = player.x;
      let y = player.y;
      let angle = player.angle;
      let clearance = 0;
      for (let index = 0; index < 22; index++) {
        angle += input * 2.65 * STEP * 2;
        x += Math.cos(angle) * this.settings.speed * STEP * 2;
        y += Math.sin(angle) * this.settings.speed * STEP * 2;
        if (this.blocked(player, x, y)) break;
        clearance++;
      }
      return { input, clearance: clearance + (input === player.input ? 0.2 : 0) };
    });
    options.sort((first, second) => second.clearance - first.clearance);
    return options[0].input;
  }

  step(dt = STEP) {
    if (this.phase === 'countdown' || this.phase === 'round-over') {
      this.timer -= dt;
      if (this.timer <= 0) {
        if (this.phase === 'countdown') this.phase = 'playing';
        else this.startRound();
      }
      return;
    }
    if (this.phase !== 'playing') return;
    this.tick++;
    const deaths = [];
    for (const player of this.players) {
      if (!player.alive) continue;
      if (player.bot && this.tick % 4 === 0) player.input = this.botInput(player);
      player.angle += player.input * 2.65 * dt;
      player.gapAt -= dt;
      if (this.settings.gaps && player.gapAt <= 0) {
        player.gap = !player.gap;
        player.gapAt = player.gap ? 0.19 + this.random() * 0.12 : 2 + this.random() * 3;
      }
      const fromX = player.x;
      const fromY = player.y;
      const distance = this.settings.speed * dt;
      const steps = Math.ceil(distance / 2);
      for (let index = 0; index < steps; index++) {
        player.x += Math.cos(player.angle) * distance / steps;
        player.y += Math.sin(player.angle) * distance / steps;
        if (this.blocked(player, player.x, player.y)) {
          player.alive = false;
          deaths.push(player);
          break;
        }
      }
      player.distance += distance;
      if (!player.gap) this.addSegment(player, fromX, fromY);
    }
    if (deaths.length) {
      for (const player of this.players) {
        if (player.alive) player.score += deaths.length;
      }
      const alive = this.players.filter(player => player.alive);
      if (alive.length <= 1) {
        this.winner = alive[0]?.id ?? null;
        const leaders = [...this.players].sort((first, second) => second.score - first.score);
        const champion = leaders[0].score >= this.settings.target && leaders[0].score > leaders[1].score;
        this.phase = champion ? 'match-over' : 'round-over';
        if (champion) this.winner = leaders[0].id;
        this.timer = 3;
      }
    }
  }

  snapshot(full = false) {
    const segments = full ? this.segments : this.pending;
    const snapshot = {
      phase: this.phase, round: this.round, timer: this.timer,
      players: this.players.map(({ id, name, color, score, x, y, angle, alive, gap, bot, slot }) =>
        ({ id, name, color, score, x, y, angle, alive, gap, bot, slot })),
      winner: this.winner, settings: this.settings, segments: [...segments], full,
    };
    if (!full) this.pending = [];
    return snapshot;
  }
}