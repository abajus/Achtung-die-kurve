import { Game, WIDTH, HEIGHT, COLORS, NAMES, STEP } from './engine.js';

const $ = selector => document.querySelector(selector);
const icons = () => window.lucide.createIcons();
const defaults = [['KeyA', 'KeyD'], ['ArrowLeft', 'ArrowRight'], ['KeyJ', 'KeyL'], ['KeyV', 'KeyN'], ['Digit4', 'Digit6'], ['KeyQ', 'KeyE']];
let roster = [0, 1].map(slot => ({ id: `local-${slot}`, slot, name: NAMES[slot], bot: false, keys: [...defaults[slot]] }));
let mode = 'local';
let game = null;
let view = null;
let paused = false;
let socket = null;
let room = null;
let myId = null;
let binding = null;
let sound = false;
let audio = null;
let lastPhase = '';
let lastAlive = 0;
let toastTimer;
let networkGeneration = 0;
const pressed = new Set();
const touch = new Set();
let drawQueue = [];
let clearTrails = true;
let demo = null;
let demoTicks = 0;
let lastTurn = 0;

function settings() {
  return { speed: Number($('#speed').value), target: Number($('#target').value), gaps: $('#gaps').checked };
}

function toast(message) {
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 3500);
}

function beep(frequency = 440, duration = 0.08, type = 'sine') {
  if (!sound) return;
  audio ??= new AudioContext();
  audio.resume();
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, audio.currentTime);
  gain.gain.setValueAtTime(0.07, audio.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + duration);
  oscillator.connect(gain).connect(audio.destination);
  oscillator.start();
  oscillator.stop(audio.currentTime + duration);
}

function keyLabel(code) {
  return { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Comma: ',', Period: '.', Slash: '/', Semicolon: ';' }[code] ?? code.replace(/^(Key|Digit|Numpad)/, '').slice(0, 5);
}

function activeMatch() { return view && !['ready', 'match-over'].includes(view.phase); }
function isHost() { return room && room.host === myId; }
function escapeText(text) { return String(text).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }

function renderRoster() {
  const players = view && activeMatch() || view?.phase === 'match-over' ? view.players : mode === 'online' ? room?.players ?? [] : roster;
  $('#player-count').innerHTML = `${String(players.length).padStart(2, '0')} <span>/ 06</span>`;
  $('#player-list').innerHTML = players.map(player => {
    const slot = player.slot;
    const playing = Boolean(view);
    const local = roster.find(entry => entry.id === player.id);
    const color = player.color ?? COLORS[slot];
    const label = mode === 'online' ? player.id === myId ? 'YOU' : player.bot ? 'CPU' : room?.host === player.id ? 'HOST' : 'ONLINE' : '';
    return `<div class="player-row ${playing && !player.alive ? 'dead' : ''}" style="--player-color:${color}">
      <span class="player-color"></span><div class="player-info"><input class="player-name" aria-label="Player ${slot + 1} name" maxlength="18" value="${escapeText(player.name)}" data-name="${player.id}" ${playing || mode === 'online' ? 'readonly' : ''}>
      ${mode === 'local' && !playing ? `<select class="player-type" aria-label="${escapeText(player.name)} type" data-type="${player.id}"><option value="human" ${!player.bot ? 'selected' : ''}>HUMAN</option><option value="bot" ${player.bot ? 'selected' : ''}>CPU</option></select>` : `<span class="player-type">${playing ? player.alive ? player.bot ? 'CPU · IN PLAY' : 'IN PLAY' : 'OUT' : label}</span>`}</div>
      <div class="player-controls">${playing ? `<span class="player-score" style="color:${color === COLORS[0] ? '#71812d' : '#5f6e56'}">${String(player.score).padStart(2, '0')}</span>` : player.bot ? '<span class="bot-label"><i data-lucide="bot"></i>CPU</span>' : (mode === 'local' ? local.keys : ['ArrowLeft', 'ArrowRight']).map((key, index) => `<button class="key" data-key="${player.id}" data-index="${index}" title="${mode === 'local' ? 'Change key' : 'Turn'} ${index ? 'right' : 'left'}" aria-label="${escapeText(player.name)} ${index ? 'right' : 'left'} key" ${mode === 'online' ? 'disabled' : ''}>${keyLabel(key)}</button>`).join('')}${!playing && mode === 'local' && roster.length > 2 ? `<button class="remove-player" data-remove="${player.id}" title="Remove player" aria-label="Remove ${escapeText(player.name)}"><i data-lucide="x"></i></button>` : ''}</div></div>`;
  }).join('');
  $('#add-player').hidden = mode === 'online' || Boolean(view);
  $('#add-player').disabled = roster.length >= 6;
  icons();
}

function updateSettingsLock() {
  const locked = activeMatch() || (mode === 'online' && !isHost());
  for (const selector of ['#speed', '#target', '#gaps', '#online-bots']) $(selector).disabled = Boolean(locked);
}

function setOverlay(kicker, title, button, caption, disabled = false) {
  $('#arena-overlay').hidden = false;
  $('#overlay-kicker').textContent = kicker;
  $('#overlay-title').innerHTML = title;
  $('#start-button span').textContent = button;
  $('#start-button').hidden = false;
  $('#start-button').disabled = disabled;
  $('#overlay-caption').textContent = caption;
}

function renderLobby() {
  $('#room-entry').hidden = Boolean(room);
  $('#room-active').hidden = !room;
  $('#online-bots-row').hidden = !room;
  if (room) {
    $('#active-code').textContent = room.code;
    $('#room-role').textContent = isHost() ? 'You are the host.' : 'Waiting for the host to start.';
    $('#speed').value = room.settings.speed;
    $('#target').value = room.settings.target;
    $('#gaps').checked = room.settings.gaps;
    $('#online-bots').value = room.bots;
    $('#connection-label').innerHTML = `<span class="live-dot"></span> ROOM ${room.code} / ${room.players.length} CONNECTED`;
  } else {
    $('#connection-label').innerHTML = `<span class="live-dot"></span> ${mode === 'local' ? 'OFFLINE IS THE NEW TOGETHER' : 'YOUR NEXT RIVAL IS A ROOM AWAY'}`;
  }
  if (!view) {
    if (mode === 'online' && !room) setOverlay('A LITTLE DISTANCE. SAME CHAOS.', 'Better<br>together<span>.</span>', 'Create a room', 'OR JOIN A FRIEND WITH A ROOM CODE');
    else if (mode === 'online') setOverlay(`ROOM / ${room.code}`, 'All roads<br>lead here<span>.</span>', isHost() ? 'Start match' : 'Waiting for host', `${room.players.length} HUMAN${room.players.length === 1 ? '' : 'S'} / ${room.bots} CPU`, !isHost());
    else setOverlay('NO BRAKES. NO SECOND CHANCES.', 'Achtung,<br>die Kurve<span>!</span>', 'Start match', `ROUND 01 / FIRST TO ${settings().target}`);
  }
  renderRoster();
  updateSettingsLock();
  icons();
}

function resetView() {
  game = null;
  view = null;
  paused = false;
  pressed.clear();
  touch.clear();
  lastPhase = '';
  clearTrails = true;
  drawQueue = [];
  demo = null;
  $('#pause-button').hidden = true;
  $('#countdown').hidden = true;
  $('#round-label').textContent = '01';
  $('#arena-status').innerHTML = '<span></span> READY TO ROLL';
  $('#arena-shell').classList.remove('playing');
  renderLobby();
}

function applyState(state) {
  if (!view || view.round !== state.round || state.full) {
    clearTrails = true;
    drawQueue = [];
    if (view && view.round !== state.round) beep(600, 0.1);
  }
  drawQueue.push(...state.segments);
  const phaseChanged = state.phase !== lastPhase;
  const alive = state.players.filter(player => player.alive).length;
  if (lastAlive > alive && !phaseChanged) beep(95, 0.18, 'sawtooth');
  lastAlive = alive;
  view = state;
  $('#round-label').textContent = String(state.round).padStart(2, '0');
  $('#arena-status').innerHTML = `<span></span> ${paused ? 'PAUSED' : { countdown: 'GET READY', playing: `${alive} STILL STANDING`, 'round-over': 'ROUND COMPLETE', 'match-over': 'WE HAVE A WINNER' }[state.phase]}`;
  $('#arena-overlay').hidden = true;
  $('#countdown').hidden = state.phase !== 'countdown';
  if (state.phase === 'countdown') {
    const count = Math.max(1, Math.ceil(state.timer));
    if ($('#countdown').textContent !== String(count)) beep(330 + count * 100, 0.07);
    $('#countdown').textContent = count;
  }
  $('#pause-button').hidden = mode === 'online' || state.phase !== 'playing';
  $('#arena-shell').classList.add('playing');
  if (state.phase === 'round-over' || state.phase === 'match-over') {
    const winner = state.players.find(player => player.id === state.winner);
    const matchOver = state.phase === 'match-over';
    setOverlay(matchOver ? 'LAST CURVE STANDING.' : `ROUND ${String(state.round).padStart(2, '0')} / COMPLETE`, winner ? `${escapeText(winner.name)}<br><span>${matchOver ? 'takes it!' : 'survives.'}</span>` : 'A beautiful<br><span>disaster.</span>', matchOver ? mode === 'online' && !isHost() ? 'Waiting for host' : 'Play again' : 'Next round', matchOver ? `FINAL SCORE / ${state.players.map(player => `${player.name} ${player.score}`).join(' · ')}` : `NEXT ROUND IN ${Math.max(1, Math.ceil(state.timer))}`, mode === 'online' && !isHost());
    $('#start-button').hidden = !matchOver;
    if (phaseChanged) beep(matchOver ? 660 : 440, 0.3, 'triangle');
  } else $('#start-button').hidden = false;
  if (phaseChanged) {
    lastPhase = state.phase;
    updateSettingsLock();
    updateTouch();
  }
  const rosterSignature = state.players.map(player => `${player.alive}-${player.score}`).join(',');
  if (phaseChanged || $('#player-list').dataset.signature !== rosterSignature) {
    $('#player-list').dataset.signature = rosterSignature;
    renderRoster();
  }
}

function startMatch() {
  if (mode === 'online') {
    if (!room) { createRoom(); return; }
    send({ type: 'start' });
    return;
  }
  if (activeMatch()) return;
  pressed.clear();
  game = new Game(roster, settings());
  game.startRound();
  paused = false;
  applyState(game.snapshot(true));
}

function send(message) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

async function connect() {
  if (socket?.readyState === WebSocket.OPEN) return socket;
  const generation = ++networkGeneration;
  socket?.close();
  return new Promise((resolve, reject) => {
    const connection = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}`);
    socket = connection;
    const timeout = setTimeout(() => { connection.close(); reject(new Error('Connection timed out.')); }, 7000);
    connection.onopen = () => { clearTimeout(timeout); resolve(connection); };
    connection.onerror = () => { clearTimeout(timeout); reject(new Error('Could not connect to the game server.')); };
    connection.onmessage = event => {
      if (generation !== networkGeneration) return;
      const message = JSON.parse(event.data);
      if (message.type === 'error') toast(message.message);
      if (message.type === 'joined') {
        myId = message.id;
        history.replaceState(null, '', `?room=${message.code}`);
      }
      if (message.type === 'lobby') {
        room = message;
        if (view?.phase === 'match-over' && !message.playing) resetView();
        else renderLobby();
      }
      if (message.type === 'state') applyState(message);
    };
    connection.onclose = () => {
      clearTimeout(timeout);
      if (generation !== networkGeneration) return;
      room = null;
      myId = null;
      resetView();
      toast('Disconnected. You can create or rejoin a room.');
    };
  });
}

async function createRoom() {
  try {
    await connect();
    send({ type: 'create', name: $('#online-name').value, settings: settings() });
  } catch (error) { toast(error.message); }
}

async function joinRoom() {
  const code = $('#room-code').value.trim().toUpperCase();
  if (code.length !== 5) return toast('Enter a five-character room code.');
  try { await connect(); send({ type: 'join', code, name: $('#online-name').value }); }
  catch (error) { toast(error.message); }
}

function leaveRoom() {
  networkGeneration++;
  socket?.close();
  socket = null;
  room = null;
  myId = null;
  history.replaceState(null, '', location.pathname);
  resetView();
}

function switchMode(next) {
  if (mode === next) return;
  if (activeMatch() && !confirm('Leave this match?')) return;
  if (mode === 'online') leaveRoom();
  mode = next;
  $('#local-tab').setAttribute('aria-selected', String(mode === 'local'));
  $('#online-tab').setAttribute('aria-selected', String(mode === 'online'));
  $('#online-panel').hidden = mode !== 'online';
  resetView();
  updateTouch();
}

function turnFor(keys) {
  return Number(pressed.has(keys[1]) || touch.has('right')) - Number(pressed.has(keys[0]) || touch.has('left'));
}

function updateInputs() {
  if (game) {
    for (const player of game.players) {
      const local = roster.find(entry => entry.id === player.id);
      if (!player.bot && local) {
        player.input = Number(pressed.has(local.keys[1]) || (player.id === roster[0].id && touch.has('right'))) - Number(pressed.has(local.keys[0]) || (player.id === roster[0].id && touch.has('left')));
      }
    }
  }
  if (mode === 'online' && room) {
    const turn = turnFor(['ArrowLeft', 'ArrowRight']) || turnFor(['KeyA', 'KeyD']);
    if (turn !== lastTurn) { send({ type: 'input', turn }); lastTurn = turn; }
  }
}

function pauseMatch() {
  if (mode !== 'local' || !game || !['playing', 'countdown'].includes(game.phase)) return;
  paused = !paused;
  if (paused) {
    setOverlay('TAKE A BREATHER.', 'Hold that<br><span>thought.</span>', 'Resume match', 'PAUSED');
    $('#countdown').hidden = true;
    $('#start-button').hidden = false;
    $('#pause-button').innerHTML = '<i data-lucide="play"></i>';
    $('#pause-button').setAttribute('aria-label', 'Resume match');
    $('#pause-button').title = 'Resume match';
  } else {
    $('#arena-overlay').hidden = true;
    $('#pause-button').innerHTML = '<i data-lucide="pause"></i>';
    $('#pause-button').setAttribute('aria-label', 'Pause match');
    $('#pause-button').title = 'Pause match';
  }
  icons();
}

function updateTouch() {
  const mobile = matchMedia('(pointer: coarse)').matches || window.innerWidth <= 800;
  $('#touch-controls').hidden = !mobile || !activeMatch();
  const player = mode === 'online' ? view?.players.find(player => player.id === myId) : roster[0];
  $('#touch-player').textContent = player?.name.toUpperCase() ?? '';
}

$('#player-list').addEventListener('click', event => {
  const key = event.target.closest('[data-key]');
  const remove = event.target.closest('[data-remove]');
  if (key && mode === 'local') {
    binding = { id: key.dataset.key, index: Number(key.dataset.index) };
    $('.key.binding')?.classList.remove('binding');
    key.classList.add('binding');
    key.textContent = '…';
  }
  if (remove) { roster = roster.filter(player => player.id !== remove.dataset.remove); renderRoster(); }
});
$('#player-list').addEventListener('change', event => {
  const player = roster.find(entry => entry.id === (event.target.dataset.name ?? event.target.dataset.type));
  if (!player || mode !== 'local' || view) return;
  if (event.target.dataset.name) player.name = event.target.value.trim() || NAMES[player.slot];
  if (event.target.dataset.type) player.bot = event.target.value === 'bot';
  renderRoster();
});
$('#add-player').onclick = () => {
  const slot = [0, 1, 2, 3, 4, 5].find(slot => !roster.some(player => player.slot === slot));
  if (slot === undefined) return;
  roster.push({ id: `local-${slot}`, slot, name: NAMES[slot], bot: true, keys: [...defaults[slot]] });
  renderRoster();
};
$('#start-button').onclick = () => paused ? pauseMatch() : startMatch();
$('#pause-button').onclick = pauseMatch;
$('#reset-button').onclick = () => {
  if (mode === 'online' && activeMatch()) return toast('Finish this match, or leave the room to start fresh.');
  if (activeMatch() && !confirm('Reset the match and all scores?')) return;
  resetView();
};
$('#local-tab').onclick = () => switchMode('local');
$('#online-tab').onclick = () => switchMode('online');
$('#create-room').onclick = createRoom;
$('#join-room').onclick = joinRoom;
$('#leave-room').onclick = leaveRoom;
$('#room-code').addEventListener('keydown', event => { if (event.key === 'Enter') joinRoom(); });
$('#copy-room').onclick = async () => {
  try { await navigator.clipboard.writeText(`${location.origin}/?room=${room.code}`); toast('Invite link copied.'); }
  catch { toast(`Room code: ${room.code}`); }
};
for (const selector of ['#speed', '#target', '#gaps', '#online-bots']) $(selector).onchange = () => {
  if (mode === 'online' && isHost()) send({ type: 'settings', settings: settings(), bots: Number($('#online-bots').value) });
  else renderLobby();
};
$('#sound-button').onclick = () => {
  sound = !sound;
  $('#sound-button').innerHTML = `<i data-lucide="${sound ? 'volume-2' : 'volume-x'}"></i>`;
  $('#sound-button').title = sound ? 'Mute sound' : 'Enable sound';
  $('#sound-button').setAttribute('aria-label', $('#sound-button').title);
  beep(); icons();
};
$('#fullscreen-button').onclick = async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if ($('#arena-shell').requestFullscreen) await $('#arena-shell').requestFullscreen();
    else toast('Fullscreen is not supported in this browser.');
  } catch { toast('Fullscreen is not available.'); }
};
document.addEventListener('keydown', event => {
  if (binding) {
    event.preventDefault();
    if (event.code !== 'Escape') {
      const player = roster.find(player => player.id === binding.id);
      if (['Escape', 'Enter', 'Space', 'Tab'].includes(event.code)) return toast('Choose a letter, number, or arrow key.');
      if (roster.some(player => player.keys.some((key, index) => key === event.code && !(player.id === binding.id && index === binding.index)))) return toast('That key is already assigned.');
      player.keys[binding.index] = event.code;
    }
    binding = null; renderRoster(); return;
  }
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(event.target.tagName)) return;
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].includes(event.code) && activeMatch()) event.preventDefault();
  pressed.add(event.code);
  if (!event.repeat && event.code === 'Enter') { if (paused) pauseMatch(); else if (!activeMatch()) startMatch(); }
  if (!event.repeat && (event.code === 'Escape' || event.code === 'Space')) pauseMatch();
  updateInputs();
});
document.addEventListener('keyup', event => { pressed.delete(event.code); updateInputs(); });
window.addEventListener('blur', () => { pressed.clear(); touch.clear(); updateInputs(); if (game && !paused && activeMatch()) pauseMatch(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) { pressed.clear(); touch.clear(); updateInputs(); } });
window.addEventListener('resize', updateTouch);
for (const direction of ['left', 'right']) {
  const button = $(`#touch-${direction}`);
  button.onpointerdown = event => { event.preventDefault(); button.setPointerCapture(event.pointerId); touch.add(direction); updateInputs(); };
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(name, () => { touch.delete(direction); updateInputs(); });
}

new p5(sketch => {
  let trails;
  let accumulator = 0;
  function drawSegments(segments) {
    trails.strokeWeight(3.3);
    for (const segment of segments) {
      trails.stroke(segment.color);
      trails.line(segment.x1, segment.y1, segment.x2, segment.y2);
    }
  }
  function createDemo() {
    demo = new Game([0, 1, 2, 3, 4, 5].map(slot => ({ id: `demo-${slot}`, slot, name: NAMES[slot], bot: true })), { speed: 150 });
    demo.startRound(); demo.phase = 'playing'; demoTicks = 0;
    for (let index = 0; index < 470; index++) {
      demo.step();
      if (demo.phase !== 'playing') break;
    }
    trails.clear();
    drawSegments(demo.snapshot().segments);
  }
  sketch.setup = () => {
    const canvas = sketch.createCanvas(WIDTH, HEIGHT);
    canvas.parent('canvas-container');
    canvas.elt.setAttribute('aria-label', 'Achtung die Kurve game arena');
    canvas.elt.setAttribute('role', 'img');
    sketch.pixelDensity(1);
    sketch.frameRate(60);
    trails = sketch.createGraphics(WIDTH, HEIGHT);
    trails.pixelDensity(1);
    trails.strokeCap(sketch.ROUND);
    createDemo();
    clearTrails = false;
  };
  sketch.draw = () => {
    const dt = Math.min(sketch.deltaTime / 1000, 0.1);
    if (game && !paused) {
      accumulator += dt;
      updateInputs();
      while (accumulator >= STEP) { game.step(); accumulator -= STEP; }
      applyState(game.snapshot());
    } else accumulator = 0;
    if (clearTrails) { trails.clear(); clearTrails = false; }
    if (!view) {
      if (!demo) createDemo();
      demoTicks++;
      if (demoTicks % 2 === 0) demo.step();
      if (demo.phase !== 'playing' && demoTicks > 360) createDemo();
      drawSegments(demo.snapshot().segments);
    } else {
      drawSegments(drawQueue);
      drawQueue = [];
    }
    sketch.background('#171b19');
    sketch.noStroke();
    sketch.fill('#2b3329');
    for (let x = 20; x < WIDTH; x += 30) for (let y = 20; y < HEIGHT; y += 30) sketch.circle(x, y, 1.5);
    if (!view) sketch.tint(255, 100);
    sketch.image(trails, 0, 0);
    sketch.noTint();
    for (const player of (view?.players ?? demo?.players ?? [])) {
      if (!player.alive) continue;
      sketch.noStroke();
      sketch.fill(player.color);
      sketch.circle(player.x, player.y, player.gap ? 5 : 7);
      sketch.fill('#171b19');
      sketch.circle(player.x + Math.cos(player.angle) * 1.5, player.y + Math.sin(player.angle) * 1.5, 2);
      if (view?.phase === 'countdown') {
        sketch.fill(player.color);
        sketch.textAlign(sketch.CENTER);
        sketch.textFont('IBM Plex Mono');
        sketch.textSize(13);
        sketch.text(player.name, player.x, player.y - 18);
      }
    }
  };
});

renderLobby();
updateTouch();
const invite = new URLSearchParams(location.search).get('room');
if (invite) { switchMode('online'); $('#room-code').value = invite.toUpperCase().slice(0, 5); $('#online-name').focus(); }