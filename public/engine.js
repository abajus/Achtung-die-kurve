import Matter from 'matter-js';

export const WIDTH = 1200;
export const HEIGHT = 760;
export const COLORS = ['#eaff63', '#fa7394', '#68d8ee', '#bd9bff', '#ffae70', '#78e2a1'];
export const NAMES = ['Citron', 'Rose', 'Glacier', 'Lilac', 'Tangerine', 'Mint'];
export const STEP = 1 / 60;

// every: ticks between decisions. horizon/second: look-ahead steps (2 ticks each) for the first
// and follow-up turn. area: open cells counted beyond the path (0 = off). hesitate: chance to skip a decision.
export const BOT_LEVELS = {
  easy: { every: 5, horizon: 18, second: 0, area: 0, hesitate: 0.05 },
  normal: { every: 4, horizon: 10, second: 12, area: 350, hesitate: 0 },
  hard: { every: 2, horizon: 12, second: 20, area: 900, hesitate: 0 },
};
const CELL = 8;
const COLS = Math.ceil(WIDTH / CELL);
const ROWS = Math.ceil(HEIGHT / CELL);
const REACH = 4.5;

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
    this.occupied = new Uint8Array(COLS * ROWS);
    this.visited = new Uint32Array(COLS * ROWS);
    this.queue = new Int32Array(COLS * ROWS);
    this.stamp = 0;
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
    this.occupied.fill(0);
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
    const entry = { body, playerId: player.id, tick: this.tick, x1: fromX, y1: fromY, x2: player.x, y2: player.y };
    for (let index = 0; index <= 2; index++) {
      const cell = this.cellIndex(fromX + (player.x - fromX) * index / 2, fromY + (player.y - fromY) * index / 2);
      if (cell >= 0) this.occupied[cell] = 1;
    }
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

  cellIndex(x, y) {
    const column = Math.floor(x / CELL);
    const row = Math.floor(y / CELL);
    return column < 0 || row < 0 || column >= COLS || row >= ROWS ? -1 : row * COLS + column;
  }

  // Cheap point-vs-trail test for bot look-ahead; slightly more cautious than the real collision.
  clear(player, x, y) {
    if (x < REACH || x > WIDTH - REACH || y < REACH || y > HEIGHT - REACH) return false;
    for (const entry of this.grid.get(this.cellKey(x, y)) ?? []) {
      if (entry.playerId === player.id && this.tick - entry.tick < 12) continue;
      const dx = entry.x2 - entry.x1;
      const dy = entry.y2 - entry.y1;
      const length = dx * dx + dy * dy;
      const t = length ? Math.max(0, Math.min(1, ((x - entry.x1) * dx + (y - entry.y1) * dy) / length)) : 0;
      if ((x - entry.x1 - t * dx) ** 2 + (y - entry.y1 - t * dy) ** 2 < REACH * REACH) return false;
    }
    return true;
  }

  // True if (x, y) at look-ahead step k lies on where a rival will have drawn by then, assuming it flies straight.
  contested(threats, x, y, k) {
    for (const { x: tx, y: ty, dx, dy } of threats) {
      const t = Math.max(0, Math.min(k + 1, ((x - tx) * dx + (y - ty) * dy) / (dx * dx + dy * dy)));
      if ((x - tx - t * dx) ** 2 + (y - ty - t * dy) ** 2 < 64) return true;
    }
    return false;
  }

  trace(player, from, input, steps, threats = [], offset = 0, path = null) {
    let { x, y, angle } = from;
    const move = this.settings.speed * STEP * 2;
    for (let index = 0; index < steps; index++) {
      angle += input * 2.65 * STEP * 2;
      x += Math.cos(angle) * move;
      y += Math.sin(angle) * move;
      path?.push(x, y);
      if (!this.clear(player, x, y) || (threats.length && this.contested(threats, x, y, offset + index))) {
        return { x, y, angle, steps: index };
      }
    }
    return { x, y, angle, steps };
  }

  // Open cells reachable from (x, y), up to cap. Gaps in trails are empty, so it sees through them.
  // The bot's own planned path (flat [x, y, ...] lists) counts as a thickened wall, since it becomes
  // trail: a narrow entrance gets sealed behind the bot, exposing pockets too tight to turn around in.
  space(x, y, cap, paths = []) {
    const start = this.cellIndex(x, y);
    if (start < 0) return 0;
    this.stamp++;
    paths.forEach((path, which) => {
      const end = which === paths.length - 1 ? path.length - 6 : path.length;
      for (let index = 0; index < end; index += 2) {
        const column = Math.floor(path[index] / CELL);
        const row = Math.floor(path[index + 1] / CELL);
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (column + dx >= 0 && column + dx < COLS && row + dy >= 0 && row + dy < ROWS) this.visited[(row + dy) * COLS + column + dx] = this.stamp;
          }
        }
      }
    });
    let head = 0;
    let tail = 0;
    this.queue[tail++] = start;
    this.visited[start] = this.stamp;
    while (head < tail && tail < cap) {
      const cell = this.queue[head++];
      const column = cell % COLS;
      for (const next of [column > 0 ? cell - 1 : -1, column < COLS - 1 ? cell + 1 : -1, cell - COLS, cell + COLS]) {
        if (next < 0 || next >= this.occupied.length || this.occupied[next] || this.visited[next] === this.stamp) continue;
        this.visited[next] = this.stamp;
        this.queue[tail++] = next;
      }
    }
    return Math.min(tail, cap);
  }

  botInput(player) {
    const level = BOT_LEVELS[player.level] ?? BOT_LEVELS.normal;
    if (level.hesitate && this.random() < level.hesitate) return player.input;
    const move = this.settings.speed * STEP * 2;
    const range = (move * (level.horizon + level.second) * 2 + 20) ** 2;
    const threats = level.second ? this.players
      .filter(other => other !== player && other.alive && (other.x - player.x) ** 2 + (other.y - player.y) ** 2 < range)
      .map(other => ({ x: other.x, y: other.y, dx: Math.cos(other.angle) * move, dy: Math.sin(other.angle) * move })) : [];
    let best = { input: 0, value: -Infinity };
    for (const input of [0, -1, 1]) {
      const firstPath = [];
      const first = this.trace(player, player, input, level.horizon, threats, 0, firstPath);
      let value = first.steps;
      if (first.steps === level.horizon && level.second) {
        let follow = 0;
        for (const next of [0, -1, 1]) {
          const secondPath = [];
          const second = this.trace(player, first, next, level.second, threats, level.horizon, secondPath);
          let score = second.steps;
          if (second.steps === level.second && level.area) {
            score += this.space(second.x, second.y, level.area, [firstPath, secondPath]) / level.area * 60;
          }
          follow = Math.max(follow, score);
        }
        value += follow;
      }
      if (input === player.input) value += 0.5;
      if (value > best.value) best = { input, value };
    }
    return best.input;
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
      const every = (BOT_LEVELS[player.level] ?? BOT_LEVELS.normal).every;
      if (player.bot && (this.tick + (player.slot ?? 0)) % every === 0) player.input = this.botInput(player);
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
      players: this.players.map(({ id, name, color, score, x, y, angle, alive, gap, bot, level, slot }) =>
        ({ id, name, color, score, x, y, angle, alive, gap, bot, level, slot })),
      winner: this.winner, settings: this.settings, segments: [...segments], full,
    };
    if (!full) this.pending = [];
    return snapshot;
  }
}