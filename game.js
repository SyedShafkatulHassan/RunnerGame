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
  const START_SPEED = 380;     // reference speed used to size gaps
  const COYOTE = 0.09;         // can still jump this long after running off an edge
  const BUFFER = 0.12;         // a press this early before landing still counts
  const STEP = 1 / 120;        // fixed physics step
  const COUNTDOWN = 3;         // seconds before a 2-player race starts

  // Difficulty presets. "ramp" = distance until obstacles reach full difficulty;
  // "react" = seconds of free running after you land, before the next obstacle (min, max);
  // "*At" = difficulty (0..1) at which that obstacle type starts appearing.
  const LEVELS = {
    easy:   { label: 'Easy',   start: 320, max: 650,  accel: 5,  ramp: 14000, react: [0.35, 0.65], ventAt: 0.15, wideAt: 0.25, droneAt: 0.4, power: 0.13 },
    medium: { label: 'Medium', start: 380, max: 900,  accel: 8,  ramp: 9000,  react: [0.22, 0.45], ventAt: 0.08, wideAt: 0.12, droneAt: 0.2, power: 0.1 },
    hard:   { label: 'Hard',   start: 450, max: 1000, accel: 11, ramp: 6000,  react: [0.14, 0.32], ventAt: 0,    wideAt: 0.03, droneAt: 0.05, power: 0.08 },
  };
  const LANDING = 0.6;         // a full jump lands about this many seconds of running past an obstacle
  const PAD_V = 1050;          // jump-pad launch speed (a much higher, longer jump)

  // Power-ups float just above head height, so you hop to grab them.
  const POWERS = {
    shield: { label: 'Shield', color: '#60a5fa', time: 0 },   // lasts until it saves you once
    magnet: { label: 'Magnet', color: '#f87171', time: 8 },
    double: { label: '2× points', color: '#fbbf24', time: 8 },
  };
  const POWER_KINDS = ['shield', 'magnet', 'double'];
  const MILESTONE = 1000;      // banner every this many points

  // Robot colours for Player 1, unlocked by your best score on any level.
  const SKINS = [
    { id: 'teal',   label: 'Teal',   need: 0,    body: '#2dd4bf', dark: '#14b8a6', legs: '#0f766e', eye: '#67e8f9', antenna: '#99f6e4' },
    { id: 'violet', label: 'Violet', need: 1500, body: '#a78bfa', dark: '#7c3aed', legs: '#4c1d95', eye: '#e9d5ff', antenna: '#ddd6fe' },
    { id: 'lime',   label: 'Lime',   need: 3000, body: '#a3e635', dark: '#65a30d', legs: '#365314', eye: '#ecfccb', antenna: '#d9f99d' },
    { id: 'gold',   label: 'Gold',   need: 6000, body: '#facc15', dark: '#ca8a04', legs: '#713f12', eye: '#fef9c3', antenna: '#fde68a' },
  ];
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
    levelBtns: document.querySelectorAll('.levels button'), levelTag: $('level-tag'),
    skinList: $('skin-list'), skinHint: $('skin-hint'),
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
  // Sky colours cycle dusk -> night -> dawn as you run.
  const SKY = [
    ['#120c33', '#3b1d6e', '#c2537a'],   // dusk
    ['#04030d', '#120e30', '#2a1c58'],   // night
    ['#1d2b63', '#5b5bb3', '#f59e7b'],   // dawn
  ];
  const SKY_LEN = 15000;  // distance per sky phase
  const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const mixHex = (a, b, t) => {
    const A = hexRgb(a), B = hexRgb(b);
    return `rgb(${A.map((v, i) => Math.round(v + (B.at(i) - v) * t)).join(',')})`;
  };
  function skyAt(cam) {
    const c = (cam / SKY_LEN) % SKY.length;
    const i = Math.floor(c);
    const f = c - i;
    const e = f * f * (3 - 2 * f);                  // smooth blend
    const a = SKY.at(i), b = SKY.at((i + 1) % SKY.length);
    const g = ctx.createLinearGradient(0, 0, 0, GROUND + 40);
    g.addColorStop(0, mixHex(a[0], b[0], e));
    g.addColorStop(0.55, mixHex(a[1], b[1], e));
    g.addColorStop(1, mixHex(a[2], b[2], e));
    const night = i === 0 ? e : i === 1 ? 1 - e : 0;
    return { g, night };
  }

  // =============================================================
  // A "run" = one player's world: their robot, their copy of the course
  // =============================================================
  function makeRun(seed, view, look) {
    const lvl = LEVELS[level];
    return {
      rng: makeRng(seed), view, look, lvl,
      cam: 0, elapsed: 0, bonus: 0, speed: lvl.start * view.speedScale,
      player: { y: GROUND - PH, vy: 0, onGround: true, jumps: 0, runT: 0, squash: 0 },
      segments: [], segStart: -400, genX: 700, obstacles: [], orbs: [], particles: [],
      alive: true, held: false, coyote: 0, buffer: 0, deathTime: 0, shake: 0,
      items: [], popups: [], banner: null, nextMilestone: MILESTONE,
      shield: false, magnetT: 0, doubleT: 0, invulnT: 0, combo: 0, comboT: 0,
    };
  }
  const scoreOf = (r) => Math.floor(r.cam / 10 + r.bonus);

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
      const L = r.lvl;
      const d = Math.min(1, r.cam / L.ramp);   // difficulty 0..1
      const v = r.speed + 30;
      const roll = r.rng();
      let pattern;
      if (roll < 0.26) pattern = 'crate';
      else if (roll < 0.38 && d >= L.wideAt) pattern = 'wide';
      else if (roll < 0.56) pattern = 'gap';
      else if (roll < 0.70 && d >= L.ventAt) pattern = 'vent';
      else if (roll < 0.84 && d >= L.droneAt) pattern = 'drone';
      else if (roll < 0.92 && d >= 0.05) pattern = 'pad';
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
        case 'pad': {
          // A spring pad: stepping on it launches you high through a trail of orbs.
          const flight = 2 * PAD_V / GRAVITY;                 // seconds in the air
          r.obstacles.push({ type: 'pad', x: r.genX, w: 36, h: 10, y: GROUND - 10 });
          addOrbArc(r, r.genX + 30, r.genX + v * flight, GROUND - PH / 2, 215, 8);
          r.genX += 36 + v * (flight - LANDING + 0.05);      // extra room for the longer flight
          break;
        }
        default: {
          addOrbArc(r, r.genX, r.genX + 180, GROUND - 24, r.rng() < 0.5 ? 0 : 70, 6);
          r.genX += 180;
        }
      }
      // Room to land from a full jump, then a reaction window before the next challenge.
      const runway = v * (LANDING + rand(L.react[0], L.react[1])) + 70 * (1 - d);
      if (r.rng() < L.power) {
        const kind = POWER_KINDS[Math.floor(r.rng() * POWER_KINDS.length)];
        r.items.push({ kind, x: r.genX + runway * 0.55, y: GROUND - 64, r: 14 });
      }
      r.genX += runway;
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
    power: () => { tone(520, 1040, 0.16, 'triangle', 0.07); setTimeout(() => tone(780, 1560, 0.14, 'triangle', 0.05), 90); },
    shield: () => tone(420, 160, 0.3, 'square', 0.05),
    pad: () => tone(180, 900, 0.28, 'sine', 0.08),
    milestone: () => { tone(660, 660, 0.1, 'triangle', 0.06); setTimeout(() => tone(990, 990, 0.16, 'triangle', 0.06), 110); },
  };

  function popup(r, x, y, text, color, size) {
    r.popups.push({ x, y, text, color: color || '#fde68a', size: size || 18, life: 0.9, max: 0.9 });
  }

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
    r.speed = Math.min(r.lvl.max, r.lvl.start + r.lvl.accel * r.elapsed) * v.speedScale;
    r.cam += r.speed * dt;
    generate(r);
    r.magnetT = Math.max(0, r.magnetT - dt);
    r.doubleT = Math.max(0, r.doubleT - dt);
    r.invulnT = Math.max(0, r.invulnT - dt);
    r.comboT = Math.max(0, r.comboT - dt);
    if (r.comboT === 0) r.combo = 0;
    if (r.doubleT > 0) r.bonus += r.speed * dt / 10; // distance counts double

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
      if (!support && r.shield && p.vy > 0 && feet > GROUND + 20) {
        // Shield saves a fall: bounce back up, with a double jump available.
        r.shield = false;
        r.invulnT = 0.8;
        p.vy = -JUMP_V * 1.15;
        p.jumps = 1;
        burst(r, wx + PW / 2, p.y + PH, 16, POWERS.shield.color, 140, 200);
        popup(r, wx + PW / 2, p.y - 10, 'Saved!', POWERS.shield.color, 22);
        sfx.shield();
      }
      if (support && feet > GROUND + 26) return die(r); // hit the side of a rooftop
    }
    r.buffer = Math.max(0, r.buffer - dt);
    if (p.y > H + 40) return die(r);

    if (p.onGround) p.runT += dt * r.speed / 60;
    p.squash *= Math.pow(0.0005, dt);

    // Obstacles (hitbox a little smaller than the drawing, to feel fair)
    const x1 = wx + 6, x2 = wx + PW - 6, y1 = p.y + 5, y2 = p.y + PH - 2;
    for (const o of r.obstacles) {
      if (o.smashed || o.x > x2 || o.x + o.w < x1) continue;
      if (o.type === 'pad') {
        if (p.onGround && x2 > o.x + 4 && x1 < o.x + o.w - 4) {
          p.vy = -PAD_V;
          p.onGround = false;
          p.jumps = 1;
          r.coyote = 0;
          p.squash = -0.25;
          o.used = 1;
          r.padCount = (r.padCount || 0) + 1;
          burst(r, wx + PW / 2, GROUND, 14, '#4ade80', 90, 260);
          sfx.pad();
        }
        continue;
      }
      const oy = o.type === 'drone' ? o.y + Math.sin(o.phase + r.elapsed * 4) * 3 : o.y;
      const pad = o.type === 'drone' ? 4 : 2;
      if (y2 > oy + pad && y1 < oy + o.h - pad && x2 > o.x + pad && x1 < o.x + o.w - pad) {
        if (r.invulnT > 0) continue;
        if (r.shield) {
          // Shield breaks the obstacle instead of you.
          r.shield = false;
          r.invulnT = 0.8;
          o.smashed = true;
          burst(r, o.x + o.w / 2, oy + o.h / 2, 18, POWERS.shield.color, 200, 260);
          popup(r, wx + PW / 2, p.y - 10, 'Shield!', POWERS.shield.color, 22);
          sfx.shield();
          continue;
        }
        return die(r);
      }
    }

    // Orbs (the magnet pulls nearby orbs towards you)
    const pcx = wx + PW / 2, pcy = p.y + PH / 2;
    for (let i = r.orbs.length - 1; i >= 0; i--) {
      const o = r.orbs[i];
      if (r.magnetT > 0 && Math.abs(o.x - pcx) < 230) {
        const k = Math.min(1, dt * 9);
        o.x += (pcx - o.x) * k;
        o.y += (pcy - o.y) * k;
      }
      const cx = Math.max(x1, Math.min(o.x, x2));
      const cy = Math.max(y1, Math.min(o.y, y2));
      if ((o.x - cx) ** 2 + (o.y - cy) ** 2 < (o.r + 2) ** 2) {
        r.orbs.splice(i, 1);
        r.combo = r.comboT > 0 ? Math.min(5, r.combo + 1) : 1;  // quick orbs build a combo
        r.comboT = 1.4;
        const pts = 25 * r.combo * (r.doubleT > 0 ? 2 : 1);
        r.bonus += pts;
        popup(r, o.x, o.y - 12, r.combo > 1 ? `+${pts} ×${r.combo}` : `+${pts}`, r.combo > 1 ? '#fbbf24' : '#fde68a', r.combo > 1 ? 20 : 16);
        burst(r, o.x, o.y, 8, '#fde68a', 90, 120);
        sfx.orb();
      }
    }

    // Power-ups
    for (let i = r.items.length - 1; i >= 0; i--) {
      const it = r.items[i];
      const cx = Math.max(x1, Math.min(it.x, x2));
      const cy = Math.max(y1, Math.min(it.y, y2));
      if ((it.x - cx) ** 2 + (it.y - cy) ** 2 < (it.r + 2) ** 2) {
        r.items.splice(i, 1);
        const P = POWERS[it.kind];
        if (it.kind === 'shield') r.shield = true;
        else if (it.kind === 'magnet') r.magnetT = P.time;
        else r.doubleT = P.time;
        popup(r, it.x, it.y - 18, P.label + '!', P.color, 22);
        burst(r, it.x, it.y, 16, P.color, 140, 160);
        sfx.power();
        r.powerCount = (r.powerCount || 0) + 1;
      }
    }

    // Milestone banner every 1,000 points
    if (scoreOf(r) >= r.nextMilestone) {
      r.banner = { text: r.nextMilestone.toLocaleString() + '!', life: 1.4, max: 1.4 };
      r.nextMilestone += MILESTONE;
      sfx.milestone();
    }

    const left = r.cam - 120;
    r.obstacles = r.obstacles.filter((o) => o.x + o.w > left);
    r.orbs = r.orbs.filter((o) => o.x > left);
    r.items = r.items.filter((it) => it.x > left);
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
    for (const q of r.popups) { q.life -= dt; q.y -= 46 * dt; }
    r.popups = r.popups.filter((q) => q.life > 0);
    if (r.banner) { r.banner.life -= dt; if (r.banner.life <= 0) r.banner = null; }
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
  let level = LEVELS[store.get('level', 'medium')] ? store.get('level', 'medium') : 'medium';
  const bestFor = (lv) => store.get('best-' + lv, lv === 'medium' ? store.get('best', 0) : 0);
  let best = bestFor(level);

  // ---------- Robot colours (unlocked by best score on any level) ----------
  let skin = store.get('skin', 'teal');
  const topBest = () => Math.max(...Object.keys(LEVELS).map(bestFor));
  const isUnlocked = (sk) => sk.need <= topBest();
  function p1Look() {
    const sk = SKINS.find((x) => x.id === skin && isUnlocked(x)) || SKINS[0];
    return { ...sk, name: 'Player 1' };
  }
  function renderSkins() {
    if (!ui.skinList) return;
    ui.skinList.textContent = '';
    for (const sk of SKINS) {
      const open = isUnlocked(sk);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'skin';
      b.style.setProperty('--c', sk.body);
      b.disabled = !open;
      b.setAttribute('aria-pressed', String(open && p1Look().id === sk.id));
      b.setAttribute('aria-label', open ? `${sk.label} robot` : `${sk.label} robot, locked until ${sk.need.toLocaleString()} points`);
      b.title = open ? sk.label : `Locked: score ${sk.need.toLocaleString()} on any level`;
      if (!open) b.classList.add('locked');
      b.addEventListener('click', () => {
        skin = sk.id;
        store.set('skin', skin);
        renderSkins();
        if (state === 'menu' && runs[0]) runs[0].look = p1Look();
      });
      ui.skinList.appendChild(b);
    }
    const next = SKINS.find((x) => !isUnlocked(x));
    ui.skinHint.textContent = next
      ? `Score ${next.need.toLocaleString()} on any level to unlock ${next.label}.`
      : 'All robot colours unlocked!';
  }
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
    runs = views.map((v, i) => makeRun(seed, v, i === 0 ? p1Look() : LOOKS[1]));
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
    runs = [makeRun(randomSeed(), views[0], p1Look())];
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
    ui.levelTag.textContent = `${LEVELS[level].label} mode`;
    ui.levelTag.dataset.level = level;
    if (mode === 'solo') {
      const score = scoreOf(runs[0]);
      const isBest = score > best;
      const topBefore = topBest();
      if (isBest) { best = score; store.set('best-' + level, best); }
      const unlocked = SKINS.filter((sk) => sk.need > topBefore && sk.need <= topBest());
      if (unlocked.length) {
        renderSkins();
        setTimeout(() => toast(`New robot colour unlocked: ${unlocked.at(-1).label}!`), 900);
      }
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
    if (o.smashed) return;
    const x = o.x - r.cam;
    if (o.type === 'pad') {
      const glow = 0.5 + 0.5 * Math.sin(t * 8 + o.x);
      ctx.fillStyle = '#334155';
      roundRect(x, GROUND - 8, o.w, 8, 3); ctx.fill();
      ctx.fillStyle = `rgba(74,222,128,${0.55 + 0.45 * glow})`;
      roundRect(x + 3, GROUND - 13, o.w - 6, 6, 3); ctx.fill();
      ctx.strokeStyle = '#bbf7d0';
      ctx.lineWidth = 2.5;
      const cx = x + o.w / 2, lift = glow * 4;
      ctx.beginPath();
      ctx.moveTo(cx - 7, GROUND - 20 - lift); ctx.lineTo(cx, GROUND - 27 - lift); ctx.lineTo(cx + 7, GROUND - 20 - lift);
      ctx.moveTo(cx - 7, GROUND - 28 - lift); ctx.lineTo(cx, GROUND - 35 - lift); ctx.lineTo(cx + 7, GROUND - 28 - lift);
      ctx.stroke();
      return;
    }
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

    const sky = skyAt(cam);
    ctx.fillStyle = sky.g;
    ctx.fillRect(-20, -20, W + 40, H + 40);
    ctx.fillStyle = `rgba(255,255,255,${0.35 + 0.55 * sky.night})`;
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

    for (const it of r.items) {
      const x = it.x - cam;
      if (x < -30 || x > W + 30) continue;
      const P = POWERS[it.kind];
      const y = it.y + Math.sin(t * 4 + it.x) * 3;
      ctx.fillStyle = P.color + '38';
      ctx.beginPath(); ctx.arc(x, y, it.r * 1.8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#0d0a22';
      ctx.strokeStyle = P.color;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(x, y, it.r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      drawIcon(it.kind, x, y, 1);
    }

    for (const o of r.obstacles) if (o.x - cam < W + 60 && o.x + o.w - cam > -60) drawObstacle(r, o, t);

    if (r.alive || performance.now() - r.deathTime < 120) {
      const PX = r.view.PX, p = r.player;
      if (r.magnetT > 0) {
        ctx.save();
        ctx.setLineDash([4, 7]);
        ctx.lineDashOffset = -t * 30;
        ctx.strokeStyle = 'rgba(248,113,113,.6)';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(PX + PW / 2, p.y + PH / 2, 40, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }
      if (r.invulnT > 0 && Math.floor(t * 20) % 2) ctx.globalAlpha = 0.45;
      drawPlayer(r, t);
      ctx.globalAlpha = 1;
      if (r.shield) {
        const rad = 31 + Math.sin(t * 5) * 1.5;
        ctx.fillStyle = 'rgba(96,165,250,.14)';
        ctx.strokeStyle = 'rgba(147,197,253,.85)';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(PX + PW / 2, p.y + PH / 2 - 3, rad, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
    }

    for (const q of r.particles) {
      ctx.globalAlpha = Math.max(0, q.life / q.max);
      ctx.fillStyle = q.color;
      ctx.fillRect(q.x - cam, q.y, q.size, q.size);
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (const q of r.popups) {
      ctx.globalAlpha = Math.min(1, Math.max(0, q.life / q.max) * 1.6);
      ctx.font = `700 ${q.size}px ${FONT}`;
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(13,10,34,.7)';
      ctx.strokeText(q.text, q.x - cam, q.y);
      ctx.fillStyle = q.color;
      ctx.fillText(q.text, q.x - cam, q.y);
    }
    ctx.textBaseline = 'alphabetic';
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function drawIcon(kind, x, y, s) {
    const col = POWERS[kind].color;
    if (kind === 'shield') {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(x, y - 8 * s); ctx.lineTo(x + 7 * s, y - 5 * s); ctx.lineTo(x + 6 * s, y + 2 * s);
      ctx.lineTo(x, y + 8 * s); ctx.lineTo(x - 6 * s, y + 2 * s); ctx.lineTo(x - 7 * s, y - 5 * s);
      ctx.closePath(); ctx.fill();
    } else if (kind === 'magnet') {
      ctx.strokeStyle = col;
      ctx.lineWidth = 4 * s;
      ctx.beginPath();
      ctx.moveTo(x - 5 * s, y - 7 * s); ctx.lineTo(x - 5 * s, y);
      ctx.arc(x, y, 5 * s, Math.PI, 0, true);
      ctx.lineTo(x + 5 * s, y - 7 * s);
      ctx.stroke();
      ctx.fillStyle = '#e5e7eb';
      ctx.fillRect(x - 7 * s, y - 9 * s, 4 * s, 3 * s);
      ctx.fillRect(x + 3 * s, y - 9 * s, 4 * s, 3 * s);
    } else {
      ctx.fillStyle = col;
      ctx.font = `700 ${Math.round(13 * s)}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('2×', x, y + 1);
      ctx.textBaseline = 'alphabetic';
    }
  }

  // Active power-ups (top centre of the lane) and milestone banner.
  function drawEffects(r, t) {
    const W = r.view.W;
    const active = [];
    if (r.shield) active.push(['shield', 1]);
    if (r.magnetT > 0) active.push(['magnet', r.magnetT / POWERS.magnet.time]);
    if (r.doubleT > 0) active.push(['double', r.doubleT / POWERS.double.time]);
    active.forEach(([kind, frac], i) => {
      const x = W / 2 - ((active.length - 1) * 44) / 2 + i * 44;
      const y = 30;
      ctx.fillStyle = 'rgba(13,10,34,.7)';
      ctx.beginPath(); ctx.arc(x, y, 18, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = POWERS[kind].color;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(x, y, 18, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac); ctx.stroke();
      drawIcon(kind, x, y, 1);
    });
    if (r.banner) {
      const b = r.banner;
      const age = b.max - b.life;
      const pop = age < 0.18 ? 0.6 + age / 0.18 * 0.5 : 1.1 - Math.min(0.1, (age - 0.18));
      ctx.save();
      ctx.globalAlpha = Math.min(1, b.life / 0.35);
      ctx.translate(W / 2, H * 0.34);
      ctx.scale(pop, pop);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `700 52px ${FONT}`;
      ctx.lineWidth = 7;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(13,10,34,.75)';
      ctx.strokeText(b.text, 0, 0);
      ctx.fillStyle = '#fbbf24';
      ctx.fillText(b.text, 0, 0);
      ctx.restore();
    }
  }

  const FONT = "ui-rounded, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"; // device fonts only

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
      drawEffects(r, t);
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
      text = `${head} in a 2-player race on Shafkat Runner (${LEVELS[level].label}) Challenge a friend!\n${url}`;
    } else {
      text = `I scored ${scoreOf(runs[0]).toLocaleString()} on Shafkat Runner in ${LEVELS[level].label} mode Can you beat me?\n${url}`;
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

  function setLevel(lv) {
    if (!LEVELS[lv]) return;
    level = lv;
    store.set('level', lv);
    best = bestFor(lv);
    ui.best.textContent = best.toLocaleString();
    ui.levelBtns.forEach((b) => b.setAttribute('aria-checked', String(b.dataset.level === lv)));
  }
  ui.levelBtns.forEach((b) => b.addEventListener('click', () => setLevel(b.dataset.level)));

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
        state, mode, level, tally: [...tally],
        runs: runs.map((r) => ({
          alive: r.alive, cam: r.cam, speed: r.speed, W: r.view.W, PX: r.view.PX, player: r.player,
          items: r.items, shield: r.shield, magnetT: r.magnetT, doubleT: r.doubleT, combo: r.combo, bonus: r.bonus,
          look: r.look.id || r.look.name, orbs: r.orbs.length,
          padCount: r.padCount || 0, powerCount: r.powerCount || 0, nextMilestone: r.nextMilestone, banner: !!r.banner,
          obstacles: r.obstacles, segments: r.segments, segStart: r.segStart, score: scoreOf(r),
        })),
      }),
      press: (i) => press(runs[i]),
      release: (i) => release(runs[i]),
      kill: (i) => { if (runs[i] && runs[i].alive) die(runs[i]); },
      setLevel,
      give: (i, k) => { const r = runs[i]; if (k === 'shield') r.shield = true; else if (k === 'magnet') r.magnetT = 8; else r.doubleT = 8; },
    };
  }

  // ---------- Start ----------
  resize();
  renderSkins();
  runs = [makeRun(randomSeed(), views[0], p1Look())];
  setLevel(level);
  ui.pauseBtn.disabled = true;
  setMuted(muted);
  requestAnimationFrame(frame);
})();
