/* ============================================================
   Shafkat Runner — an endless rooftop runner, 1 or 2 players.
   Pure front-end: <canvas> + plain JavaScript, no assets, no backend.
   All artwork is drawn in code, so there are no image licences to worry about.
   In 2-player mode both players run the SAME course (same random seed),
   each in their own half of the screen.
   ============================================================ */
(() => {
  'use strict';

  // ---------- Tuning ----------
  const H = 400;               // logical world height of one lane (width adapts to the screen)
  const GROUND = 320;          // y of the rooftop surface
  const PW = 34, PH = 40;      // player size
  const GRAVITY = 2400;
  const JUMP_V = 820;          // first jump
  const DOUBLE_V = 720;        // mid-air jump
  const CUT_V = 460;           // releasing early caps the upward speed -> short hop
  const MAX_FALL = 1500;
  const START_SPEED = 380;
  const MAX_SPEED = 900;
  const ACCEL = 8;             // speed gained per second
  const COYOTE = 0.09;         // can still jump this long after running off an edge
  const BUFFER = 0.12;         // a press this early before landing still counts
  const STEP = 1 / 120;        // fixed physics step
  const COUNTDOWN = 3;         // seconds before a 2-player race starts
  const NS = 'shafkat-runner:v1:';

  const LOOKS = [
    { name: 'Player 1', body: '#2dd4bf', dark: '#14b8a6', legs: '#0f766e', eye: '#67e8f9', antenna: '#99f6e4' },
    { name: 'Player 2', body: '#fb923c', dark: '#ea580c', legs: '#9a3412', eye: '#fde68a', antenna: '#fed7aa' },
  ];

  // ---------- Storage ----------
  const store = {
    get(k, f) { try { const v = localStorage.getItem(NS + k); return v === null ? f : JSON.parse(v); } catch { return f; } },
    set(k, v) { try { localStorage.setItem(NS + k, JSON.stringify(v)); } catch { /* ignore */ } },
  };

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const canvas = $('canvas');
  const ctx = canvas.getContext('2d');
  const ui = {
    game: $('game'), hud: $('hud'), score: $('score'), best: $('best'),
    start: $('start-screen'), over: $('over-screen'), pause: $('pause-screen'),
    soloBtn: $('solo-btn'), versusBtn: $('versus-btn'),
    againBtn: $('again-btn'), menuBtn: $('menu-btn'), shareBtn: $('share-btn'), resumeBtn: $('resume-btn'),
    overTitle: $('over-title'), soloResult: $('solo-result'), vsResult: $('vs-result'),
    finalScore: $('final-score'), finalBest: $('final-best'), newBest: $('new-best'),
    vsS1: $('vs-s1'), vsS2: $('vs-s2'), vsRow1: $('vs-row1'), vsRow2: $('vs-row2'), vsTally: $('vs-tally'),
    pauseBtn: $('pause-btn'), soundBtn: $('sound-btn'), toast: $('toast'),
  };

  // ---------- Random numbers ----------
  function makeRng(seed) { // mulberry32: same seed -> same sequence
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = Math.imul(s ^ (s >>> 15), s | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const randomSeed = () => {
    try { return crypto.getRandomValues(new Uint32Array(1))[0]; }
    catch { return Math.floor(Math.random() * 4294967296); }
  };
  const fx = (a, b) => a + Math.random() * (b - a); // visual effects only

  // ---------- Sizing: one lane (1 player) or two stacked lanes (2 players) ----------
  let mode = 'solo';      // 'solo' | 'versus'
  let views = [];
  let cssW = 0, cssH = 0, dpr = 1;

  function layoutViews() {
    const n = mode === 'versus' ? 2 : 1;
    const h = cssH / n;
    const scale = h / H || 1;
    const W = cssW / scale || 640;
    views = Array.from({ length: n }, (_, i) => ({
      y: i * h, h, scale, W,
      PX: Math.max(50, Math.min(120, W * 0.15)),
      speedScale: Math.max(0.75, Math.min(1, W / 640)), // narrow lanes run slower so reaction time stays fair
    }));
    runs.forEach((r, i) => { if (views[i]) r.view = views[i]; });
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    cssW = rect.width;
    cssH = rect.height;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    layoutViews();
  }

  // ---------- Background (generated once, tiled) ----------
  function makeSkyline(count, minH, maxH, minW, maxW, windowChance) {
    const blds = [];
    let x = 0;
    for (let i = 0; i < count; i++) {
      const w = fx(minW, maxW);
      const h = fx(minH, maxH);
      const wins = [];
      for (let wy = 14; wy < h - 10; wy += 16) {
        for (let wx = 8; wx < w - 10; wx += 14) if (Math.random() < windowChance) wins.push([wx, wy]);
      }
      blds.push({ x, w, h, wins });
      x += w + 6 + fx(0, 18);
    }
    return { blds, length: x };
  }
  const farCity = makeSkyline(26, 70, 170, 40, 90, 0.12);
  const nearCity = makeSkyline(22, 50, 120, 50, 110, 0.18);
  const stars = Array.from({ length: 60 }, () => [fx(0, 1600), fx(0, 180), fx(0.4, 1.8)]);
  const skyGrad = ctx.createLinearGradient(0, 0, 0, GROUND + 40);
  skyGrad.addColorStop(0, '#120c33');
  skyGrad.addColorStop(0.55, '#3b1d6e');
  skyGrad.addColorStop(1, '#c2537a');

  // =============================================================
  // A "run" = one player's world: their robot, their copy of the course
  // =============================================================
  function makeRun(seed, view, look) {
    return {
      rng: makeRng(seed), view, look,
      cam: 0, elapsed: 0, orbScore: 0, speed: START_SPEED * view.speedScale,
      player: { y: GROUND - PH, vy: 0, onGround: true, jumps: 0, runT: 0, squash: 0 },
      segments: [], segStart: -400, genX: 700, obstacles: [], orbs: [], particles: [],
      alive: true, held: false, coyote: 0, buffer: 0, deathTime: 0, shake: 0,
    };
  }
  const scoreOf = (r) => Math.floor(r.cam / 10) + r.orbScore;

  // ---------- Level generator (uses the run's own seeded rng) ----------
  function addOrbArc(r, x1, x2, baseY, peak, n) {
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1);
      r.orbs.push({ x: x1 + (x2 - x1) * t, y: baseY - peak * 4 * t * (1 - t), r: 9 });
    }
  }

  function generate(r) {
    const rand = (a, b) => a + r.rng() * (b - a);
    while (r.genX < r.cam + r.view.W + 400) {
      const d = Math.min(1, r.cam / 9000);     // difficulty 0..1
      const v = r.speed + 30;
      const roll = r.rng();
      let pattern;
      if (roll < 0.26) pattern = 'crate';
      else if (roll < 0.38 && d > 0.12) pattern = 'wide';
      else if (roll < 0.56) pattern = 'gap';
      else if (roll < 0.70 && d > 0.08) pattern = 'vent';
      else if (roll < 0.84 && d > 0.2) pattern = 'drone';
      else pattern = 'orbs';

      switch (pattern) {
        case 'crate': {
          const h = rand(34, 44 + 24 * d);
          r.obstacles.push({ type: 'crate', x: r.genX, w: 40, h, y: GROUND - h });
          if (r.rng() < 0.5) addOrbArc(r, r.genX - 20, r.genX + 60, GROUND - h - 30, 26, 3);
          r.genX += 40;
          break;
        }
        case 'wide': {
          r.obstacles.push({ type: 'crate', x: r.genX, w: 80, h: 40, y: GROUND - 40 });
          r.genX += 80;
          break;
        }
        case 'gap': {
          const reach = v * (2 * JUMP_V / GRAVITY);          // ground distance of a full jump
          const w = Math.min(reach * 0.62, rand(80, 110 + 90 * d) * (v / START_SPEED));
          r.segments.push({ x1: r.segStart, x2: r.genX });
          if (r.rng() < 0.6) addOrbArc(r, r.genX - 10, r.genX + w + 10, GROUND - 30, 90, 5);
          r.genX += w;
          r.segStart = r.genX;
          break;
        }
        case 'vent': {
          const h = rand(62, 72 + 16 * d);
          r.obstacles.push({ type: 'vent', x: r.genX, w: 24, h, y: GROUND - h });
          r.genX += 24;
          break;
        }
        case 'drone': {
          // Hovers at head height: running underneath is safe, jumping into it is not.
          r.obstacles.push({ type: 'drone', x: r.genX, w: 44, h: 20, y: GROUND - PH - 18 - 20, phase: rand(0, 6) });
          addOrbArc(r, r.genX - 30, r.genX + 74, GROUND - 22, 0, 4);
          r.genX += 44;
          break;
        }
        default: {
          addOrbArc(r, r.genX, r.genX + 180, GROUND - 24, r.rng() < 0.5 ? 0 : 70, 6);
          r.genX += 180;
        }
      }
      r.genX += v * rand(0.55, 0.85) + 70 * (1 - d); // safe runway before the next challenge
    }
  }

  function groundUnder(r, a, b) {
    if (r.segStart < b) return true; // the open rooftop being generated
    for (const s of r.segments) if (s.x1 < b && s.x2 > a) return true;
    return false;
  }

  // ---------- Sound (synthesised, no audio files) ----------
  let actx = null;
  let muted = store.get('muted', false);
  function audio() {
    if (!actx) {
      try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch { actx = null; }
    }
    if (actx && actx.state === 'suspended') actx.resume();
    return actx;
  }
  function tone(f1, f2, dur, type, vol) {
    if (muted) return;
    const a = audio();
    if (!a) return;
    const t = a.currentTime;
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f1, t);
    o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(a.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
  const sfx = {
    jump: (i) => tone(i ? 260 : 300, i ? 540 : 620, 0.12, 'square', 0.045),
    double: (i) => tone(i ? 400 : 460, i ? 800 : 920, 0.12, 'square', 0.045),
    orb: () => tone(900, 1400, 0.09, 'sine', 0.06),
    crash: () => tone(240, 50, 0.45, 'sawtooth', 0.07),
    beep: (hi) => tone(hi ? 880 : 520, hi ? 880 : 520, 0.15, 'sine', 0.07),
  };

  // ---------- Particles ----------
  function burst(r, x, y, n, color, spread, up) {
    for (let i = 0; i < n; i++) {
      r.particles.push({
        x, y, vx: fx(-spread, spread) - r.speed * 0.2, vy: fx(-up, -up * 0.2),
        life: fx(0.3, 0.6), max: 0.6, color, size: fx(2, 4),
      });
    }
  }

  // ---------- Controls ----------
  function press(r) {
    audio(); // unlock audio on the first user gesture
    if (state !== 'running' || !r || !r.alive) return;
    r.held = true;
    const p = r.player;
    const idx = runs.indexOf(r);
    if (p.onGround || r.coyote > 0) {
      p.vy = -JUMP_V;
      p.onGround = false;
      p.jumps = 1;
      r.coyote = 0;
      p.squash = -0.18;
      burst(r, r.cam + r.view.PX + PW / 2, GROUND, 6, '#c4b5fd', 60, 120);
      sfx.jump(idx);
    } else if (p.jumps < 2) {
      p.vy = -DOUBLE_V;
      p.jumps = 2;
      burst(r, r.cam + r.view.PX + PW / 2, p.y + PH, 8, r.look.eye, 80, 40);
      sfx.double(idx);
    } else {
      r.buffer = BUFFER; // remember the press and jump on landing
    }
  }

  function release(r) {
    if (!r) return;
    r.held = false;
    if (state === 'running' && r.alive && r.player.vy < -CUT_V) r.player.vy = -CUT_V;
  }

  // ---------- Simulation ----------
  function update(r, dt) {
    const v = r.view;
    r.elapsed += dt;
    r.speed = Math.min(MAX_SPEED, START_SPEED + ACCEL * r.elapsed) * v.speedScale;
    r.cam += r.speed * dt;
    generate(r);

    const p = r.player;
    const wx = r.cam + v.PX;
    p.vy = Math.min(MAX_FALL, p.vy + GRAVITY * dt);
    p.y += p.vy * dt;

    const feet = p.y + PH;
    const support = groundUnder(r, wx + 6, wx + PW - 6);
    if (support && p.vy >= 0 && feet >= GROUND && feet <= GROUND + 26) {
      if (!p.onGround) {
        p.squash = 0.22;
        burst(r, wx + PW / 2, GROUND, 5, '#a78bfa', 70, 80);
      }
      p.y = GROUND - PH;
      p.vy = 0;
      p.onGround = true;
      p.jumps = 0;
      r.coyote = COYOTE;
      if (r.buffer > 0) {
        r.buffer = 0;
        const stillHeld = r.held;
        press(r);
        if (!stillHeld) release(r);
      }
    } else {
      if (p.onGround && !support) p.onGround = false; // ran off an edge
      if (!p.onGround) r.coyote = Math.max(0, r.coyote - dt);
      if (support && feet > GROUND + 26) return die(r); // hit the side of a rooftop
    }
    r.buffer = Math.max(0, r.buffer - dt);
    if (p.y > H + 40) return die(r);

    if (p.onGround) p.runT += dt * r.speed / 60;
    p.squash *= Math.pow(0.0005, dt);

    // Obstacles (hitbox a little smaller than the drawing, to feel fair)
    const x1 = wx + 6, x2 = wx + PW - 6, y1 = p.y + 5, y2 = p.y + PH - 2;
    for (const o of r.obstacles) {
      if (o.x > x2 || o.x + o.w < x1) continue;
      const oy = o.type === 'drone' ? o.y + Math.sin(o.phase + r.elapsed * 4) * 3 : o.y;
      const pad = o.type === 'drone' ? 4 : 2;
      if (y2 > oy + pad && y1 < oy + o.h - pad && x2 > o.x + pad && x1 < o.x + o.w - pad) return die(r);
    }

    // Orbs
    for (let i = r.orbs.length - 1; i >= 0; i--) {
      const o = r.orbs[i];
      const cx = Math.max(x1, Math.min(o.x, x2));
      const cy = Math.max(y1, Math.min(o.y, y2));
      if ((o.x - cx) ** 2 + (o.y - cy) ** 2 < (o.r + 2) ** 2) {
        r.orbs.splice(i, 1);
        r.orbScore += 25;
        burst(r, o.x, o.y, 8, '#fde68a', 90, 120);
        sfx.orb();
      }
    }

    const left = r.cam - 120;
    r.obstacles = r.obstacles.filter((o) => o.x + o.w > left);
    r.orbs = r.orbs.filter((o) => o.x > left);
    r.segments = r.segments.filter((s) => s.x2 > left);
  }

  function updateParticles(r, dt) {
    for (const q of r.particles) {
      q.life -= dt;
      q.vy += 900 * dt;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
    }
    r.particles = r.particles.filter((q) => q.life > 0);
    r.shake = Math.max(0, r.shake - dt);
  }

  // =============================================================
  // Match flow
  // =============================================================
  let state = 'menu';   // menu | countdown | running | paused | over
  let pausedFrom = null;
  let runs = [];
  let countdown = 0;
  let lastBeep = -1;
  let overTimer = null;
  let best = store.get('best', 0);
  const tally = [0, 0]; // 2-player wins this session
  const pointerOwner = new Map();

  function setMode(m) {
    mode = m;
    ui.game.classList.toggle('versus', m === 'versus');
    resize();
  }

  function startGame(m) {
    clearTimeout(overTimer);
    setMode(m);
    const seed = randomSeed();
    runs = views.map((v, i) => makeRun(seed, v, LOOKS[i]));
    ui.start.hidden = true;
    ui.over.hidden = true;
    ui.pause.hidden = true;
    ui.pauseBtn.disabled = false;
    pointerOwner.clear();
    if (m === 'versus') {
      state = 'countdown';
      countdown = COUNTDOWN;
      lastBeep = -1;
    } else {
      state = 'running';
    }
    store.set('runs', store.get('runs', 0) + 1);
    ui.game.focus({ preventScroll: true });
  }

  function showMenu() {
    clearTimeout(overTimer);
    state = 'menu';
    ui.over.hidden = true;
    ui.pause.hidden = true;
    ui.start.hidden = false;
    ui.pauseBtn.disabled = true;
    setMode('solo');
    runs = [makeRun(randomSeed(), views[0], LOOKS[0])];
    ui.soloBtn.focus({ preventScroll: true });
  }

  function die(r) {
    r.alive = false;
    r.held = false;
    r.deathTime = performance.now();
    r.shake = 0.35;
    burst(r, r.cam + r.view.PX + PW / 2, r.player.y + PH / 2, 22, '#fb7185', 220, 320);
    sfx.crash();
    if (runs.every((x) => !x.alive)) endMatch();
  }

  function endMatch() {
    state = 'over';
    ui.pauseBtn.disabled = true;
    if (mode === 'solo') {
      const score = scoreOf(runs[0]);
      const isBest = score > best;
      if (isBest) { best = score; store.set('best', best); }
      ui.overTitle.textContent = 'Game over';
      ui.finalScore.textContent = score.toLocaleString();
      ui.finalBest.textContent = best.toLocaleString();
      ui.best.textContent = best.toLocaleString();
      ui.newBest.hidden = !isBest;
      ui.soloResult.hidden = false;
      ui.vsResult.hidden = true;
    } else {
      const [s1, s2] = runs.map(scoreOf);
      const winner = s1 === s2 ? -1 : (s1 > s2 ? 0 : 1);
      if (winner >= 0) tally[winner] += 1;
      ui.overTitle.textContent = winner < 0 ? "It's a tie!" : `${LOOKS[winner].name} wins!`;
      ui.vsS1.textContent = s1.toLocaleString();
      ui.vsS2.textContent = s2.toLocaleString();
      ui.vsRow1.classList.toggle('win', winner === 0);
      ui.vsRow2.classList.toggle('win', winner === 1);
      ui.vsTally.textContent = `${tally[0]} – ${tally[1]}`;
      ui.soloResult.hidden = true;
      ui.vsResult.hidden = false;
    }
    overTimer = setTimeout(() => {
      ui.over.hidden = false;
      ui.againBtn.focus({ preventScroll: true });
    }, 700);
  }

  function setPaused(on) {
    if (on && (state === 'running' || state === 'countdown')) {
      pausedFrom = state;
      state = 'paused';
      runs.forEach((r) => { r.held = false; });
      pointerOwner.clear();
      ui.pause.hidden = false;
      ui.resumeBtn.focus({ preventScroll: true });
    } else if (!on && state === 'paused') {
      state = pausedFrom || 'running';
      ui.pause.hidden = true;
      ui.game.focus({ preventScroll: true });
    }
  }

  // =============================================================
  // Drawing
  // =============================================================
  function roundRect(x, y, w, h, rad) {
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
  }

  function drawCity(city, cam, W, factor, baseY, body, windowColor) {
    const off = (cam * factor) % city.length;
    for (let rep = -1; rep * city.length - off < W + 200; rep++) {
      const ox = rep * city.length - off;
      for (const b of city.blds) {
        const x = ox + b.x;
        if (x > W || x + b.w < 0) continue;
        ctx.fillStyle = body;
        ctx.fillRect(x, baseY - b.h, b.w, b.h + 80);
        ctx.fillStyle = windowColor;
        for (const [wx, wy] of b.wins) ctx.fillRect(x + wx, baseY - b.h + wy, 5, 7);
      }
    }
  }

  function drawPlayer(r, t) {
    const p = r.player;
    const L = r.look;
    const PX = r.view.PX;
    const sq = p.squash;
    const w = PW * (1 + sq * 0.6);
    const h = PH * (1 - sq * 0.6);
    const x = PX + (PW - w) / 2;
    const y = p.y + (PH - h);
    const bodyH = h - 8;
    const moving = state === 'running' && r.alive;

    ctx.fillStyle = L.legs;
    if (p.onGround && moving) {
      const s = Math.sin(p.runT * 1.4) * 4;
      ctx.fillRect(x + 7 + s, y + bodyH - 1, 7, 9);
      ctx.fillRect(x + w - 14 - s, y + bodyH - 1, 7, 9);
    } else {
      ctx.fillRect(x + 8, y + bodyH - 2, 7, 6);
      ctx.fillRect(x + w - 15, y + bodyH - 2, 7, 6);
    }

    const bob = moving ? 0 : Math.sin(t * 3) * 1.5;
    ctx.strokeStyle = L.antenna;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + w / 2, y + 1);
    ctx.lineTo(x + w / 2 + 3, y - 9 + bob);
    ctx.stroke();
    ctx.fillStyle = 'rgba(251,191,36,.35)';
    ctx.beginPath(); ctx.arc(x + w / 2 + 3, y - 10 + bob, 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fbbf24';
    ctx.beginPath(); ctx.arc(x + w / 2 + 3, y - 10 + bob, 3, 0, Math.PI * 2); ctx.fill();

    ctx.fillStyle = L.body;
    roundRect(x, y, w, bodyH, 9); ctx.fill();
    ctx.fillStyle = L.dark;
    roundRect(x, y + bodyH * 0.62, w, bodyH * 0.38, 8); ctx.fill();

    ctx.fillStyle = '#0b1530';
    roundRect(x + 6, y + 7, w - 10, 13, 6); ctx.fill();
    ctx.fillStyle = L.eye;
    const blink = (Math.floor(t * 10) % 40 === 0) ? 1.5 : 6;
    roundRect(x + w - 15, y + 13.5 - blink / 2, 7, blink, 2); ctx.fill();
  }

  function drawObstacle(r, o, t) {
    const x = o.x - r.cam;
    if (o.type === 'crate') {
      for (let cx = 0; cx < o.w; cx += 40) {
        const bx = x + cx;
        ctx.fillStyle = '#f59e0b';
        roundRect(bx + 1, o.y, 38, o.h, 4); ctx.fill();
        ctx.strokeStyle = '#b45309';
        ctx.lineWidth = 3;
        roundRect(bx + 2.5, o.y + 1.5, 35, o.h - 3, 3); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(bx + 6, o.y + 6); ctx.lineTo(bx + 34, o.y + o.h - 6);
        ctx.moveTo(bx + 34, o.y + 6); ctx.lineTo(bx + 6, o.y + o.h - 6);
        ctx.stroke();
      }
    } else if (o.type === 'vent') {
      ctx.fillStyle = '#64748b';
      ctx.fillRect(x + 3, o.y + 8, o.w - 6, o.h - 8);
      ctx.fillStyle = '#94a3b8';
      roundRect(x, o.y, o.w, 12, 3); ctx.fill();
      ctx.fillStyle = '#f43f5e';
      ctx.fillRect(x + 3, o.y + o.h * 0.45, o.w - 6, 6);
      ctx.fillStyle = 'rgba(203,213,225,.25)';
      ctx.beginPath(); ctx.arc(x + o.w / 2, o.y - 8 + Math.sin(t * 2 + o.x) * 2, 7, 0, Math.PI * 2); ctx.fill();
    } else if (o.type === 'drone') {
      const y = o.y + Math.sin(o.phase + r.elapsed * 4) * 3;
      ctx.strokeStyle = 'rgba(226,232,240,.75)';
      ctx.lineWidth = 2;
      const spin = Math.sin(t * 40) * 9;
      ctx.beginPath();
      ctx.moveTo(x + 8 - spin, y - 4); ctx.lineTo(x + 8 + spin, y - 4);
      ctx.moveTo(x + o.w - 8 - spin, y - 4); ctx.lineTo(x + o.w - 8 + spin, y - 4);
      ctx.stroke();
      ctx.fillStyle = '#cbd5e1';
      ctx.fillRect(x + 7, y - 4, 2, 5);
      ctx.fillRect(x + o.w - 9, y - 4, 2, 5);
      ctx.fillStyle = '#475569';
      roundRect(x, y, o.w, o.h, 8); ctx.fill();
      ctx.fillStyle = '#334155';
      roundRect(x + 4, y + o.h - 7, o.w - 8, 7, 3); ctx.fill();
      ctx.fillStyle = Math.sin(t * 8) > 0 ? '#ef4444' : '#7f1d1d';
      ctx.beginPath(); ctx.arc(x + o.w / 2, y + 8, 3.5, 0, Math.PI * 2); ctx.fill();
    }
  }

  function drawWorld(r, t) {
    const W = r.view.W;
    const cam = r.cam;
    ctx.save();
    if (r.shake > 0) ctx.translate(fx(-1, 1) * r.shake * 14, fx(-1, 1) * r.shake * 14);

    ctx.fillStyle = skyGrad;
    ctx.fillRect(-20, -20, W + 40, H + 40);
    ctx.fillStyle = 'rgba(255,255,255,.7)';
    for (const [sx, sy, sr] of stars) {
      const x = ((sx - cam * 0.03) % 1600 + 1600) % 1600;
      if (x < W) ctx.fillRect(x, sy, sr, sr);
    }
    ctx.fillStyle = 'rgba(253,230,138,.15)';
    ctx.beginPath(); ctx.arc(W * 0.78, 70, 46, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fde68a';
    ctx.beginPath(); ctx.arc(W * 0.78, 70, 26, 0, Math.PI * 2); ctx.fill();

    drawCity(farCity, cam, W, 0.15, GROUND + 10, '#2a1b5c', 'rgba(251,191,36,.35)');
    drawCity(nearCity, cam, W, 0.4, GROUND + 30, '#1c1342', 'rgba(253,224,71,.55)');

    const drawRoof = (x1, x2) => {
      const a = Math.max(-10, x1 - cam);
      const b = Math.min(W + 10, x2 - cam);
      if (b <= a) return;
      ctx.fillStyle = '#120d2b';
      ctx.fillRect(a, GROUND, b - a, H - GROUND);
      ctx.fillStyle = '#3b2f78';
      ctx.fillRect(a, GROUND, b - a, 7);
      ctx.fillStyle = '#7c6cf0';
      ctx.fillRect(a, GROUND, b - a, 2);
      ctx.fillStyle = '#1d1640';
      for (let px = Math.ceil(x1 / 46) * 46; px < x2; px += 46) {
        const sx = px - cam;
        if (sx > a - 4 && sx < b) ctx.fillRect(sx, GROUND + 18, 3, H - GROUND - 18);
      }
    };
    for (const s of r.segments) drawRoof(s.x1, s.x2);
    drawRoof(r.segStart, cam + W + 50);

    for (const o of r.orbs) {
      const x = o.x - cam;
      if (x < -20 || x > W + 20) continue;
      const pulse = 1 + Math.sin(t * 6 + o.x) * 0.12;
      ctx.fillStyle = 'rgba(253,224,71,.22)';
      ctx.beginPath(); ctx.arc(x, o.y, o.r * 1.9 * pulse, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fde047';
      ctx.beginPath(); ctx.arc(x, o.y, o.r * 0.8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff7cc';
      ctx.beginPath(); ctx.arc(x - 2, o.y - 2, o.r * 0.3, 0, Math.PI * 2); ctx.fill();
    }

    for (const o of r.obstacles) if (o.x - cam < W + 60 && o.x + o.w - cam > -60) drawObstacle(r, o, t);

    if (r.alive || performance.now() - r.deathTime < 120) drawPlayer(r, t);

    for (const q of r.particles) {
      ctx.globalAlpha = Math.max(0, q.life / q.max);
      ctx.fillStyle = q.color;
      ctx.fillRect(q.x - cam, q.y, q.size, q.size);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  const FONT = "'Fredoka', ui-rounded, 'Segoe UI', system-ui, sans-serif";

  function drawLaneHud(r, i) {
    const W = r.view.W;
    const s = scoreOf(r).toLocaleString();
    ctx.font = `600 20px ${FONT}`;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    roundRect(12, 12, 172, 36, 10); ctx.fill();
    ctx.fillStyle = r.look.body;
    ctx.beginPath(); ctx.arc(32, 30, 7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(`P${i + 1}`, 46, 37);
    ctx.font = `700 22px ${FONT}`;
    ctx.textAlign = 'right';
    ctx.fillText(s, 174, 38);

    if (!r.alive) {
      ctx.fillStyle = 'rgba(13,10,34,.55)';
      ctx.fillRect(0, 0, W, H);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fff';
      ctx.font = `700 46px ${FONT}`;
      ctx.fillText('OUT', W / 2, H / 2 - 6);
      ctx.font = `600 22px ${FONT}`;
      ctx.fillStyle = 'rgba(241,238,255,.85)';
      const other = runs[1 - i];
      const msg = other && other.alive ? `${s} points · waiting for ${other.look.name}` : `${s} points`;
      ctx.fillText(msg, W / 2, H / 2 + 30);
    }
  }

  function drawControlsHint(r, i) {
    // Shown during the countdown so each player knows their button.
    const W = r.view.W;
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(0,0,0,.4)';
    roundRect(W / 2 - 170, H - 64, 340, 40, 12); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = `600 18px ${FONT}`;
    ctx.fillText(i === 0 ? 'Player 1: press W or tap here' : 'Player 2: press ↑ or tap here', W / 2, H - 38);
  }

  function render(t) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    runs.forEach((r, i) => {
      const v = r.view;
      ctx.setTransform(dpr * v.scale, 0, 0, dpr * v.scale, 0, dpr * v.y);
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, v.W, H);
      ctx.clip();
      drawWorld(r, t);
      if (mode === 'versus') {
        drawLaneHud(r, i);
        if (state === 'countdown' || (state === 'paused' && pausedFrom === 'countdown')) drawControlsHint(r, i);
      }
      ctx.restore();
    });

    if (mode === 'versus') {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#0d0a22';
      ctx.fillRect(0, cssH / 2 - 2, cssW, 4);
      if (state === 'countdown' || (state === 'paused' && pausedFrom === 'countdown')) {
        const n = Math.ceil(countdown);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(13,10,34,.75)';
        ctx.beginPath(); ctx.arc(cssW / 2, cssH / 2, 44, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fbbf24';
        ctx.font = `700 54px ${FONT}`;
        ctx.fillText(String(Math.max(1, n)), cssW / 2, cssH / 2 + 3);
        ctx.textBaseline = 'alphabetic';
      }
    }
  }

  // ---------- Main loop ----------
  let last = 0;
  let acc = 0;
  let shownScore = -1;
  function frame(ms) {
    const now = ms / 1000;
    const dt = last ? Math.min(0.05, now - last) : 0;
    last = now;

    if (state === 'countdown') {
      countdown -= dt;
      const n = Math.ceil(countdown);
      if (n !== lastBeep && n > 0) { lastBeep = n; sfx.beep(false); }
      if (countdown <= 0) { state = 'running'; acc = 0; sfx.beep(true); }
    }
    if (state === 'running') {
      acc += dt;
      while (acc >= STEP) {
        for (const r of runs) if (r.alive) update(r, STEP);
        acc -= STEP;
        if (state !== 'running') { acc = 0; break; }
      }
    }
    if (state !== 'paused') runs.forEach((r) => updateParticles(r, dt));

    if (mode === 'solo' && runs[0]) {
      const s = scoreOf(runs[0]);
      if (s !== shownScore) { shownScore = s; ui.score.textContent = s.toLocaleString(); }
    }

    render(now);
    requestAnimationFrame(frame);
  }

  // ---------- Share ----------
  async function share() {
    const url = location.origin + location.pathname.replace(/index\.html$/, '');
    let text;
    if (mode === 'versus') {
      const [s1, s2] = runs.map(scoreOf);
      const head = s1 === s2 ? `We tied at ${s1.toLocaleString()}` :
        `${s1 > s2 ? 'Player 1' : 'Player 2'} won ${Math.max(s1, s2).toLocaleString()} to ${Math.min(s1, s2).toLocaleString()}`;
      text = `${head} in a 2-player race on Shafkat Runner 🤖🏙️ Challenge a friend!\n${url}`;
    } else {
      text = `I scored ${scoreOf(runs[0]).toLocaleString()} on Shafkat Runner 🤖🏙️ Can you beat me?\n${url}`;
    }
    if (navigator.share && matchMedia('(pointer: coarse)').matches) {
      try { await navigator.share({ text }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
    }
    try { await navigator.clipboard.writeText(text); toast('Copied — paste it anywhere!'); }
    catch { toast('Could not copy — please try again'); }
  }

  let toastTimer = null;
  function toast(msg) {
    ui.toast.textContent = msg;
    ui.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ui.toast.classList.remove('show'), 2200);
  }

  function setMuted(m) {
    muted = m;
    store.set('muted', m);
    ui.soundBtn.classList.toggle('muted', m);
    ui.soundBtn.setAttribute('aria-label', m ? 'Unmute sound' : 'Mute sound');
  }

  // ---------- Input wiring ----------
  // Which run a key controls: in 1-player any jump key; in 2-player W = P1, ↑ = P2.
  function runForKey(key) {
    if (mode === 'solo') return [' ', 'Spacebar', 'ArrowUp', 'w', 'W'].includes(key) ? runs[0] : null;
    if (key === 'w' || key === 'W') return runs[0];
    if (key === 'ArrowUp') return runs[1];
    return null;
  }
  const isJumpKey = (k) => [' ', 'Spacebar', 'ArrowUp', 'w', 'W'].includes(k);

  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (isJumpKey(e.key)) {
      // Let Space/Enter work normally on focused buttons when not mid-game.
      if (e.target.closest && e.target.closest('button, a') && state !== 'running' && state !== 'countdown') return;
      e.preventDefault();
      if (e.repeat) return;
      if (state === 'over') {
        if (!ui.over.hidden) startGame(mode);
        return;
      }
      if (state === 'running') press(runForKey(e.key));
    } else if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') {
      setPaused(state === 'running' || state === 'countdown');
    } else if (e.key === 'm' || e.key === 'M') {
      setMuted(!muted);
    }
  });
  document.addEventListener('keyup', (e) => { if (isJumpKey(e.key)) release(runForKey(e.key)); });

  // Touch / mouse: in 2-player the top half belongs to P1 and the bottom half to P2.
  // Each finger is tracked separately, so both players can hold at the same time.
  ui.game.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button, a')) return;
    if (state !== 'running' && state !== 'countdown') return;
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const idx = mode === 'versus' && e.clientY - rect.top > rect.height / 2 ? 1 : 0;
    pointerOwner.set(e.pointerId, idx);
    press(runs[idx]);
  });
  const endPointer = (e) => {
    if (!pointerOwner.has(e.pointerId)) return;
    release(runs[pointerOwner.get(e.pointerId)]);
    pointerOwner.delete(e.pointerId);
  };
  window.addEventListener('pointerup', endPointer);
  window.addEventListener('pointercancel', endPointer);
  ui.game.addEventListener('contextmenu', (e) => e.preventDefault());

  ui.soloBtn.addEventListener('click', () => { audio(); startGame('solo'); });
  ui.versusBtn.addEventListener('click', () => { audio(); startGame('versus'); });
  ui.againBtn.addEventListener('click', () => { audio(); startGame(mode); });
  ui.menuBtn.addEventListener('click', showMenu);
  ui.shareBtn.addEventListener('click', share);
  ui.resumeBtn.addEventListener('click', () => setPaused(false));
  ui.pauseBtn.addEventListener('click', () => setPaused(state === 'running' || state === 'countdown'));
  ui.soundBtn.addEventListener('click', () => setMuted(!muted));

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') setPaused(true);
  });
  window.addEventListener('blur', () => setPaused(true));
  window.addEventListener('resize', resize);

  // Debug hooks for automated testing only: add ?debug=1 to the URL.
  if (new URLSearchParams(location.search).has('debug')) {
    window.__game = {
      get: () => ({
        state, mode, tally: [...tally],
        runs: runs.map((r) => ({
          alive: r.alive, cam: r.cam, speed: r.speed, W: r.view.W, PX: r.view.PX, player: r.player,
          obstacles: r.obstacles, segments: r.segments, segStart: r.segStart, score: scoreOf(r),
        })),
      }),
      press: (i) => press(runs[i]),
      release: (i) => release(runs[i]),
      kill: (i) => { if (runs[i] && runs[i].alive) die(runs[i]); },
    };
  }

  // ---------- Start ----------
  resize();
  runs = [makeRun(randomSeed(), views[0], LOOKS[0])];
  ui.best.textContent = best.toLocaleString();
  ui.pauseBtn.disabled = true;
  setMuted(muted);
  requestAnimationFrame(frame);
})();
