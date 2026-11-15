'use strict';
/* ============================================================
   PIXEL HOPPER — a tiny platformer. No dependencies, works offline.
   Logical screen 480x272 (30x17 tiles of 16px), scaled to fit.
   ============================================================ */
(() => {
const TS = 16, VW = 480, VH = 272, ROWS = 17, GROUND = 14;
const FONT = '"Courier New", ui-monospace, Menlo, Consolas, monospace';
const $ = id => document.getElementById(id);
const cv = $('c'), ctx = cv.getContext('2d');
cv.width = VW; cv.height = VH;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ---------------- storage ---------------- */
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
};
let best = store.get('ph_best', 0);
let maxLevel = store.get('ph_level', 1);
let soundMode = store.get('ph_sound', 1);          // 0 off, 1 effects, 2 effects + music

/* ---------------- audio ---------------- */
let ac = null;
function initAudio() {
  if (!ac) { const A = window.AudioContext || window.webkitAudioContext; if (A) ac = new A(); }
  if (ac && ac.state === 'suspended') ac.resume();
}
function tone(f, d, type = 'square', slide = 0, vol = 0.07, delay = 0) {
  if (!soundMode || !ac) return;
  const t = ac.currentTime + delay, o = ac.createOscillator(), g = ac.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, f * slide), t + d);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  o.connect(g); g.connect(ac.destination); o.start(t); o.stop(t + d + 0.03);
}
const arp = (notes, step = 0.07, type = 'square', vol = 0.06) =>
  notes.forEach((n, i) => tone(n, step * 1.6, type, 0, vol, i * step));
const sfx = {
  jump: () => tone(330, 0.18, 'square', 2.2, 0.06),
  coin: () => { tone(988, 0.06, 'square', 0, 0.05); tone(1319, 0.22, 'square', 0, 0.05, 0.06); },
  stomp: () => tone(240, 0.14, 'square', 0.4, 0.09),
  bump: () => tone(130, 0.09, 'square', 0.6, 0.08),
  brick: () => tone(200, 0.18, 'sawtooth', 0.3, 0.08),
  power: () => arp([392, 523, 659, 784, 1047]),
  hurt: () => tone(420, 0.28, 'sawtooth', 0.4, 0.08),
  die: () => arp([523, 494, 466, 440, 415, 392, 370, 349], 0.09, 'triangle', 0.09),
  life: () => arp([659, 784, 1047, 1319, 1568]),
  clear: () => arp([523, 659, 784, 1047, 784, 1047, 1319], 0.09),
  tick: () => tone(1200, 0.03, 'square', 0, 0.035),
  start: () => arp([392, 523, 659], 0.08)
};
const vibrate = ms => { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {} };

/* tiny chiptune loop (optional, mode 2) */
const SC = [261.6, 293.7, 329.6, 392, 440, 523.3, 587.3, 659.3];
const TUNES = [
  [5, 0, 4, 0, 3, 0, 4, 5, 6, 0, 5, 0, 4, 0, 3, 0],
  [3, 0, 2, 0, 3, 0, 5, 0, 4, 0, 3, 0, 2, 0, 1, 0],
  [4, 0, 0, 3, 0, 0, 2, 0, 3, 0, 0, 4, 0, 0, 5, 0]
];
const BASS = [130.8, 110, 87.3, 98];
let musicStep = 0, musicTimer = null;
function startMusic() {
  if (musicTimer) return;
  musicTimer = setInterval(() => {
    if (soundMode < 2 || paused || state !== 'play' || !ac) return;
    const tune = TUNES[(level - 1) % 3], n = tune[musicStep % tune.length];
    if (n) tone(SC[n], 0.15, 'triangle', 0, 0.05);
    if (musicStep % 4 === 0) tone(BASS[(musicStep >> 2) % 4], 0.3, 'square', 0, 0.025);
    musicStep++;
  }, 170);
}

/* ---------------- themes ---------------- */
const THEMES = [
  { sky: ['#4cc3ff', '#d4f3ff'], hill: ['#6fd488', '#45b36a'], grass: '#4fcf3f', grassD: '#2e9f2e', dirt: '#c8803c', dirtD: '#9b5f2a',
    brick: '#d4552f', brickD: '#8e3418', cloud: 'rgba(255,255,255,.95)', pit: '#2a1d3d', kind: 'day' },
  { sky: ['#ff8a5c', '#ffd98a'], hill: ['#b070c8', '#84469e'], grass: '#bccb3a', grassD: '#7e9422', dirt: '#b8683a', dirtD: '#8a4425',
    brick: '#c9482f', brickD: '#7d2c1c', cloud: 'rgba(255,236,214,.9)', pit: '#2a1230', kind: 'dusk' },
  { sky: ['#0c1438', '#2d3f7d'], hill: ['#33529a', '#213872'], grass: '#3dd6a3', grassD: '#1d9c7c', dirt: '#5d4a8a', dirtD: '#3f2f66',
    brick: '#8a5cd6', brickD: '#4f2f8c', cloud: 'rgba(160,180,255,.22)', pit: '#07091a', kind: 'night' }
];

/* ---------------- level generator (deterministic per level) ---------------- */
function rng(a) {
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const isSolid = v => v === 1 || v >= 3;
// tile ids: 0 air, 1 ground, 3 brick, 4 ? block, 5 used block, 6 pipe, 7 hard block

function genLevel(n) {
  const R = rng(n * 7919 + 13), ri = (a, b) => a + Math.floor(R() * (b - a + 1));
  const W = Math.min(110 + n * 12, 230);
  const t = new Uint8Array(W * ROWS), content = new Map(), coins = [], enemies = [];
  const set = (x, y, v) => { if (x >= 0 && x < W && y >= 0 && y < ROWS) t[y * W + x] = v; };
  const ground = (a, b) => { for (let x = a; x <= b; x++) for (let y = GROUND; y < ROWS; y++) set(x, y, 1); };
  const coin = (x, y) => coins.push({ x: x * TS + 8, y: y * TS + 8, got: false });
  const coinRow = (x, len, y) => { for (let i = 0; i < len; i++) coin(x + i, y); };
  const enemy = (x, type) => enemies.push({ x: x * TS + 1, y: GROUND * TS - (type === 'spike' ? 12 : 14), type });

  let x = 0, last = '', cp = 0;
  ground(0, 11); x = 12;
  const end = W - 26;
  while (x < end) {
    if (!cp && x > W * 0.5) { ground(x, x + 5); cp = x + 2; x += 6; last = 'flat'; continue; }
    const pool = ['flat', 'blocks', 'plat', 'enemies', 'enemies', 'pipe'];
    if (n >= 1) pool.push('gap');
    if (n >= 2) pool.push('stairs', 'gap');
    if (n >= 3) pool.push('islands', 'spikes');
    if (n >= 4) pool.push('gap', 'spikes', 'enemies');
    let k = pool[ri(0, pool.length - 1)];
    if ((k === 'gap' || k === 'islands') && (last === 'gap' || last === 'islands')) k = 'flat';

    switch (k) {
      case 'flat': {
        const len = ri(3, 6); ground(x, x + len - 1);
        if (R() < 0.5) coinRow(x + 1, Math.min(len - 2, 4), GROUND - 2);
        x += len; break; }
      case 'gap': {
        const gw = ri(2, n >= 6 ? 4 : 3), land = ri(4, 6);
        for (let i = 0; i < gw; i++) coin(x + i, GROUND - 3);
        ground(x + gw, x + gw + land - 1);
        if (n >= 2 && R() < 0.35) enemy(x + gw + land - 2, 'walk');
        x += gw + land; break; }
      case 'pipe': {
        const h = (n >= 3 && R() < 0.4) ? 3 : 2; ground(x, x + 7);
        for (let yy = GROUND - h; yy < GROUND; yy++) { set(x + 3, yy, 6); set(x + 4, yy, 6); }
        if (n >= 2 && R() < 0.5) enemy(x + 6, 'walk');
        coinRow(x + 3, 2, GROUND - h - 2);
        x += 8; break; }
      case 'stairs': {
        const s = ri(2, 4), total = s * 2 + 2; ground(x, x + total - 1);
        for (let i = 0; i < s; i++) for (let hh = 1; hh <= i + 1; hh++) set(x + i, GROUND - hh, 7);
        for (let i = 0; i < 2; i++) for (let hh = 1; hh <= s; hh++) set(x + s + i, GROUND - hh, 7);
        for (let j = 0; j < s - 1; j++) for (let hh = 1; hh <= s - 1 - j; hh++) set(x + s + 2 + j, GROUND - hh, 7);
        coinRow(x + s, 2, GROUND - s - 2);
        x += total; break; }
      case 'plat': {
        const len = ri(7, 10); ground(x, x + len - 1);
        const pl = ri(3, 5), px = x + 1 + ri(0, len - pl - 2);
        for (let i = 0; i < pl; i++) set(px + i, GROUND - 3, 3);
        coinRow(px, pl, GROUND - 4);
        if (R() < 0.6) { const qi = px + ri(0, pl - 1); set(qi, GROUND - 3, 4); content.set((GROUND - 3) * W + qi, R() < 0.3 ? 'power' : 'coin'); }
        if (n >= 2 && R() < 0.4) enemy(x + len - 2, 'walk');
        x += len; break; }
      case 'enemies': {
        const len = ri(8, 12); ground(x, x + len - 1);
        const c = ri(1, Math.min(3, 1 + Math.floor(n / 2)));
        for (let i = 0; i < c; i++) enemy(x + 2 + Math.floor((len - 4) * (i + 1) / (c + 1)), 'walk');
        x += len; break; }
      case 'blocks': {
        const len = ri(7, 10); ground(x, x + len - 1);
        for (let i = 0; i < 5; i++) {
          const bx = x + 1 + i, q = i % 2 === 1; set(bx, GROUND - 3, q ? 4 : 3);
          if (q) content.set((GROUND - 3) * W + bx, (i === 1 && R() < 0.5) ? 'power' : 'coin');
        }
        x += len; break; }
      case 'islands': {
        const cnt = ri(2, 3);
        for (let i = 0; i < cnt; i++) { coin(x, GROUND - 3); coin(x + 1, GROUND - 3); ground(x + 2, x + 4); x += 5; }
        coin(x, GROUND - 3); coin(x + 1, GROUND - 3); ground(x + 2, x + 5); x += 6; break; }
      case 'spikes': {
        const len = ri(8, 11); ground(x, x + len - 1);
        const sx = x + ri(3, len - 5); enemy(sx, 'spike');
        if (n >= 5 && len >= 10 && R() < 0.5) enemy(x + len - 3, 'spike');
        coinRow(sx - 1, 3, GROUND - 4);
        x += len; break; }
    }
    last = k;
  }
  ground(x, W - 1);
  return { W, t, content, coins, enemies, cp, flagX: (W - 9) * TS, castleX: (W - 5) * TS, theme: (n - 1) % 3 };
}

/* ---------------- sprites (drawn in code, rebuilt per theme) ---------------- */
let spr = {};
function mk(fn) { const c = document.createElement('canvas'); c.width = c.height = TS; const g = c.getContext('2d'); fn(g); return c; }
function buildSprites(th) {
  spr.dirt = mk(g => { g.fillStyle = th.dirt; g.fillRect(0, 0, 16, 16); g.fillStyle = th.dirtD;
    [[3, 4], [10, 3], [6, 9], [13, 11], [2, 13]].forEach(([a, b]) => g.fillRect(a, b, 2, 2)); });
  spr.grass = mk(g => { g.drawImage(spr.dirt, 0, 0); g.fillStyle = th.grass; g.fillRect(0, 0, 16, 5);
    g.fillStyle = th.grassD; g.fillRect(0, 4, 16, 1); for (let i = 0; i < 16; i += 4) g.fillRect(i, 5, 2, 2);
    g.fillStyle = 'rgba(255,255,255,.25)'; g.fillRect(0, 0, 16, 1); });
  spr.brick = mk(g => { g.fillStyle = th.brickD; g.fillRect(0, 0, 16, 16); g.fillStyle = th.brick;
    g.fillRect(0, 0, 7, 3); g.fillRect(8, 0, 8, 3); g.fillRect(0, 4, 3, 3); g.fillRect(4, 4, 8, 3); g.fillRect(13, 4, 3, 3);
    g.fillRect(0, 8, 7, 3); g.fillRect(8, 8, 8, 3); g.fillRect(0, 12, 3, 4); g.fillRect(4, 12, 8, 4); g.fillRect(13, 12, 3, 4); });
  const q = (c1, c2) => mk(g => { g.fillStyle = '#8a5a00'; g.fillRect(0, 0, 16, 16); g.fillStyle = c1; g.fillRect(1, 1, 14, 14);
    g.fillStyle = c2; g.fillRect(1, 1, 14, 2); g.fillRect(1, 1, 2, 14); g.fillStyle = '#8a5a00';
    [[2, 2], [13, 2], [2, 13], [13, 13]].forEach(([a, b]) => g.fillRect(a, b, 1, 1));
    g.fillStyle = '#fff3b0'; g.font = 'bold 11px ' + FONT; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('?', 8, 9); });
  spr.q1 = q('#ffc21a', '#ffe27a'); spr.q2 = q('#ffb000', '#ffd24a');
  spr.used = mk(g => { g.fillStyle = '#5a4a3a'; g.fillRect(0, 0, 16, 16); g.fillStyle = '#8c7a66'; g.fillRect(1, 1, 14, 14);
    g.fillStyle = '#5a4a3a'; [[3, 3], [12, 3], [3, 12], [12, 12]].forEach(([a, b]) => g.fillRect(a, b, 1, 1)); });
  spr.hard = mk(g => { g.fillStyle = th.dirtD; g.fillRect(0, 0, 16, 16); g.fillStyle = th.dirt; g.fillRect(1, 1, 14, 14);
    g.fillStyle = 'rgba(255,255,255,.3)'; g.fillRect(1, 1, 14, 2); g.fillRect(1, 1, 2, 14);
    g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(1, 13, 14, 2); g.fillRect(13, 1, 2, 14); });
  const body = left => mk(g => { g.fillStyle = '#0f5a24'; g.fillRect(left ? 0 : 15, 0, 1, 16); g.fillStyle = '#2fc24f';
    g.fillRect(left ? 1 : 0, 0, 15, 16); g.fillStyle = left ? '#8af59a' : '#1d8a38'; g.fillRect(left ? 3 : 9, 0, 3, 16); });
  const cap = left => mk(g => { g.fillStyle = '#0f5a24'; g.fillRect(0, 0, 16, 16); g.fillStyle = '#2fc24f';
    g.fillRect(left ? 1 : 0, 1, 15, 14); g.fillStyle = left ? '#8af59a' : '#1d8a38'; g.fillRect(left ? 3 : 9, 1, 3, 14); });
  spr.bodyL = body(true); spr.bodyR = body(false); spr.capL = cap(true); spr.capR = cap(false);
}
function makeSky(th) {
  const c = document.createElement('canvas'); c.width = VW; c.height = VH; const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, GROUND * TS); gr.addColorStop(0, th.sky[0]); gr.addColorStop(1, th.sky[1]);
  g.fillStyle = gr; g.fillRect(0, 0, VW, VH); return c;
}

/* ---------------- state ---------------- */
let state = 'title', paused = false, frame = 0;
let L = null, TH = THEMES[0], skyCv = null;
let level = 1, lives = 3, score = 0, coinsN = 0, timeLeft = 0, timeAcc = 0, banner = 0, combo = 0;
let cpReached = false, dyingT = 0, clearPhase = 0, clearT = 0, flagY = 0, flagBonus = 0;
let enemies = [], items = [], coinsL = [], fx = [], bumps = new Map();
const cam = { x: 0 };
const P = { x: 0, y: 0, w: 12, h: 14, vx: 0, vy: 0, on: false, dir: 1, anim: 0, power: false, inv: 0, coy: 0, jbuf: 0, hidden: false };

buildSprites(TH); skyCv = makeSky(TH);

/* ---------------- input ---------------- */
const keys = new Set(); let touchKeys = new Set();
const inp = { left: false, right: false, jump: false, run: false, jumpP: false, _pj: false };
let enterP = false, lastTap = null;
const padBtns = [...document.querySelectorAll('[data-k]')];
function readInput() {
  inp.left = keys.has('ArrowLeft') || keys.has('KeyA') || touchKeys.has('left');
  inp.right = keys.has('ArrowRight') || keys.has('KeyD') || touchKeys.has('right');
  inp.jump = keys.has('ArrowUp') || keys.has('KeyW') || keys.has('Space') || keys.has('KeyZ') || keys.has('KeyK') || touchKeys.has('jump');
  inp.run = keys.has('ShiftLeft') || keys.has('ShiftRight') || keys.has('KeyX') || keys.has('KeyJ') || touchKeys.has('run');
  inp.jumpP = inp.jump && !inp._pj; inp._pj = inp.jump;
}
addEventListener('keydown', e => {
  initAudio();
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  if (e.repeat) { keys.add(e.code); return; }
  keys.add(e.code);
  if (e.code === 'KeyP' || e.code === 'Escape') togglePause();
  else if (e.code === 'KeyM') cycleSound();
  else if (e.code === 'KeyF') toggleFull();
  else if (e.code === 'Enter') enterP = true;
  else if (e.code === 'KeyN' && state === 'title') startGame(1);
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => { keys.clear(); if (state === 'play') paused = true; });
document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'play') paused = true; });
document.addEventListener('contextmenu', e => e.preventDefault());

function toLogical(pt) {
  const r = cv.getBoundingClientRect();
  return { x: (pt.clientX - r.left) * VW / r.width, y: (pt.clientY - r.top) * VH / r.height };
}
function closestAttr(el, sel) { return el && el.closest ? el.closest(sel) : null; }
function onTouch(e) {
  initAudio(); e.preventDefault();
  touchKeys = new Set();
  for (const t of e.touches) {
    const b = closestAttr(document.elementFromPoint(t.clientX, t.clientY), '[data-k]');
    if (b) touchKeys.add(b.dataset.k);
  }
  padBtns.forEach(b => b.classList.toggle('on', touchKeys.has(b.dataset.k)));
  if (e.type === 'touchstart') {
    for (const t of e.changedTouches) {
      const el = document.elementFromPoint(t.clientX, t.clientY);
      const a = closestAttr(el, '[data-act]');
      if (a) doAct(a.dataset.act);
      else if (!closestAttr(el, '[data-k]')) lastTap = toLogical(t);
    }
  }
}
['touchstart', 'touchmove', 'touchend', 'touchcancel'].forEach(n => document.addEventListener(n, onTouch, { passive: false }));
document.addEventListener('mousedown', e => {
  initAudio(); e.preventDefault();
  const a = closestAttr(e.target, '[data-act]');
  if (a) doAct(a.dataset.act); else lastTap = toLogical(e);
});
function doAct(a) { if (a === 'pause') togglePause(); else if (a === 'sound') cycleSound(); else if (a === 'full') toggleFull(); }
function togglePause() { if (state === 'play' || state === 'dying' || state === 'clear') paused = !paused; }
function cycleSound() {
  soundMode = (soundMode + 1) % 3; store.set('ph_sound', soundMode); updateSoundBtn();
  initAudio(); if (soundMode === 2) startMusic(); if (soundMode) tone(660, 0.08, 'square', 0, 0.05);
}
function updateSoundBtn() { $('bS').textContent = ['\u{1F507}', '\u{1F508}', '\u{1F3B5}'][soundMode]; }
function toggleFull() {
  const d = document, el = d.documentElement;
  if (!d.fullscreenElement) {
    (el.requestFullscreen ? el.requestFullscreen() : Promise.reject()).then(() => {
      try { screen.orientation.lock('landscape').catch(() => {}); } catch (e) {}
    }).catch(() => {});
  } else d.exitFullscreen();
}
updateSoundBtn(); if (soundMode === 2) startMusic();
if ('ontouchstart' in window || navigator.maxTouchPoints > 0) document.body.classList.add('touch');

/* ---------------- layout ---------------- */
function resize() {
  const w = innerWidth, h = innerHeight, portrait = h > w;
  const s = Math.min(w / VW, h / VH), cw = VW * s, ch = VH * s;
  cv.style.width = cw + 'px'; cv.style.height = ch + 'px';
  cv.style.left = ((w - cw) / 2) + 'px';
  const top = portrait ? Math.max(0, (h - ch) * 0.1) : (h - ch) / 2;
  cv.style.top = top + 'px';
  $('hint').style.top = (top + ch + 10) + 'px';
  document.body.classList.toggle('portrait', portrait);
}
addEventListener('resize', resize); addEventListener('orientationchange', () => setTimeout(resize, 150)); resize();

/* ---------------- world helpers ---------------- */
function tile(tx, ty) {
  if (tx < 0 || tx >= L.W) return 1;
  if (ty < 0 || ty >= ROWS) return 0;
  return L.t[ty * L.W + tx];
}
function moveX(e) {
  e.x += e.vx;
  const y0 = Math.floor(e.y / TS), y1 = Math.floor((e.y + e.h - 0.01) / TS);
  if (e.vx > 0) {
    const tx = Math.floor((e.x + e.w - 0.01) / TS);
    for (let ty = y0; ty <= y1; ty++) if (isSolid(tile(tx, ty))) { e.x = tx * TS - e.w; e.vx = 0; return true; }
  } else if (e.vx < 0) {
    const tx = Math.floor(e.x / TS);
    for (let ty = y0; ty <= y1; ty++) if (isSolid(tile(tx, ty))) { e.x = (tx + 1) * TS; e.vx = 0; return true; }
  }
  return false;
}
function moveY(e) {
  e.y += e.vy; e.on = false;
  const x0 = Math.floor(e.x / TS), x1 = Math.floor((e.x + e.w - 0.01) / TS);
  if (e.vy >= 0) {
    const ty = Math.floor((e.y + e.h - 0.01) / TS);
    for (let tx = x0; tx <= x1; tx++) if (isSolid(tile(tx, ty))) { e.y = ty * TS - e.h; e.vy = 0; e.on = true; return null; }
  } else {
    const ty = Math.floor(e.y / TS), cx = e.x + e.w / 2; let bx = -1, bd = 1e9;
    for (let tx = x0; tx <= x1; tx++) if (isSolid(tile(tx, ty))) { const d = Math.abs(tx * TS + 8 - cx); if (d < bd) { bd = d; bx = tx; } }
    if (bx >= 0) { e.y = (ty + 1) * TS; e.vy = 0; return { tx: bx, ty }; }
  }
  return null;
}

/* ---------------- effects ---------------- */
function spark(x, y, col, n = 6) {
  for (let i = 0; i < n; i++) fx.push({ kind: 'rect', x, y, vx: (Math.random() - 0.5) * 3, vy: -Math.random() * 3 - 0.5, g: 0.2, life: 24 + Math.random() * 10, col, s: 2 });
}
function floatText(s, x, y) { fx.push({ kind: 'text', text: s, x, y, vx: 0, vy: -0.7, g: 0, life: 45 }); }
function updateFx() {
  for (const f of fx) { f.x += f.vx; f.y += f.vy; f.vy += f.g; f.life--; }
  fx = fx.filter(f => f.life > 0);
  for (const [k, v] of bumps) { if (v <= 1) bumps.delete(k); else bumps.set(k, v - 1); }
}
function addScore(n) { score += n; }
function addCoin() {
  coinsN++; addScore(10);
  if (coinsN >= 100) { coinsN -= 100; lives++; sfx.life(); floatText('1UP', P.x, P.y - 8); }
}

/* ---------------- game flow ---------------- */
function startGame(n) {
  initAudio(); lives = 3; score = 0; coinsN = 0; P.power = false; paused = false;
  loadLevel(n, false); sfx.start();
}
function loadLevel(n, keepCp) {
  level = n; L = genLevel(n); TH = THEMES[L.theme]; buildSprites(TH); skyCv = makeSky(TH);
  enemies = L.enemies.map((e, i) => Object.assign({}, e, { w: 14, h: e.type === 'spike' ? 12 : 14, vx: 0, vy: 0, dir: i % 2 ? 1 : -1, on: false, anim: 0 }));
  coinsL = L.coins.map(c => Object.assign({}, c));
  items = []; fx = []; bumps = new Map();
  if (!keepCp) cpReached = false;
  P.x = (keepCp && cpReached) ? L.cp * TS : 2 * TS; P.y = GROUND * TS - P.h;
  P.vx = P.vy = 0; P.on = true; P.dir = 1; P.inv = 0; P.hidden = false; P.coy = P.jbuf = 0; combo = 0;
  timeLeft = L.W + 80; timeAcc = 0; banner = 150; flagY = 4 * TS + 4;
  cam.x = clamp(P.x - VW * 0.3, 0, L.W * TS - VW); state = 'play';
}
function die() {
  if (state !== 'play') return;
  state = 'dying'; dyingT = 0; P.vx = 0; P.vy = P.y > VH ? 0 : -7; sfx.die(); vibrate(60);
}
function hurt() {
  if (P.inv > 0) return;
  if (P.power) { P.power = false; P.inv = 110; P.vy = -4; sfx.hurt(); vibrate(30); }
  else die();
}
function afterDeath() {
  lives--; P.power = false;
  if (lives <= 0) { state = 'gameover'; if (score > best) { best = score; store.set('ph_best', best); } }
  else loadLevel(level, true);
}
function startClear() {
  state = 'clear'; clearPhase = 0; clearT = 0; P.vx = P.vy = 0; P.x = L.flagX - 4; P.dir = 1;
  const ratio = clamp((GROUND * TS - (P.y + P.h)) / (GROUND * TS - 4 * TS), 0, 1);
  flagBonus = 100 * (1 + Math.round(ratio * 9)); addScore(flagBonus); sfx.clear(); vibrate(40);
}
function nextLevel() {
  if (score > best) { best = score; store.set('ph_best', best); }
  maxLevel = Math.max(maxLevel, level + 1); store.set('ph_level', maxLevel);
  loadLevel(level + 1, false);
}

/* ---------------- updates ---------------- */
function updatePlayer() {
  const tgt = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
  const max = inp.run ? 2.35 : 1.5, acc = P.on ? 0.22 : 0.14;
  if (tgt) {
    if (P.vx * tgt < max) P.vx += tgt * acc;
    if (Math.abs(P.vx) > max) P.vx -= Math.sign(P.vx) * 0.15;
    P.dir = tgt;
  } else {
    const fr = P.on ? 0.25 : 0.04;
    P.vx = Math.abs(P.vx) <= fr ? 0 : P.vx - Math.sign(P.vx) * fr;
  }
  if (inp.jumpP) P.jbuf = 7; else if (P.jbuf > 0) P.jbuf--;
  if (P.on) P.coy = 6; else if (P.coy > 0) P.coy--;
  if (P.jbuf > 0 && P.coy > 0) { P.vy = -6.6 - Math.abs(P.vx) * 0.15; P.on = false; P.coy = 0; P.jbuf = 0; sfx.jump(); }
  if (P.vy < 0) P.vy += inp.jump ? 0.34 : 0.8; else P.vy += 0.5;
  if (P.vy > 7.5) P.vy = 7.5;
  moveX(P);
  const head = moveY(P);
  if (head) hitBlock(head.tx, head.ty);
  if (P.on) { combo = 0; P.anim += Math.abs(P.vx) * 0.25; }
  if (P.y > VH + 10) die();
}
function hitBlock(tx, ty) {
  const i = ty * L.W + tx, v = L.t[i];
  if (v === 4) {
    L.t[i] = 5; bumps.set(i, 10);
    if (L.content.get(i) === 'power') {
      items.push({ type: 'mush', x: tx * TS + 2, y: ty * TS + 4, w: 12, h: 12, vx: 0, vy: 0, dirv: 1, emerge: 16, on: false });
      sfx.bump();
    } else {
      addCoin(); sfx.coin(); fx.push({ kind: 'coin', x: tx * TS + 8, y: ty * TS - 2, vx: 0, vy: -5, g: 0.35, life: 26 });
    }
    killAbove(tx, ty);
  } else if (v === 3) {
    if (P.power) {
      L.t[i] = 0; addScore(50); sfx.brick();
      for (let k = 0; k < 4; k++) fx.push({ kind: 'rect', x: tx * TS + 4 + (k % 2) * 8, y: ty * TS + 4 + (k >> 1) * 8, vx: (k % 2 ? 1 : -1) * (1 + Math.random()), vy: -4 - Math.random() * 2, g: 0.4, life: 50, col: TH.brick, s: 4 });
    } else { bumps.set(i, 10); sfx.bump(); }
    killAbove(tx, ty);
  } else sfx.bump();
}
function killAbove(tx, ty) {
  for (const e of enemies) {
    if (e.squashed || e.dead) continue;
    if (Math.abs(e.x + e.w / 2 - (tx * TS + 8)) < 14 && Math.abs(e.y + e.h - ty * TS) < 4) {
      e.dead = true; e.vy = -3.5; e.dvx = 0.6; addScore(100); floatText('100', e.x, e.y - 6); sfx.stomp();
    }
  }
}
function updateEnemies() {
  for (const e of enemies) {
    if (e.squashed) { if (--e.squash <= 0) e.gone = true; continue; }
    if (e.dead) { e.vy += 0.4; e.y += e.vy; e.x += e.dvx || 0; if (e.y > VH + 40) e.gone = true; continue; }
    if (Math.abs(e.x + 7 - (cam.x + VW / 2)) > VW * 0.8) continue;
    e.anim++;
    if (e.type === 'walk') {
      e.vx = e.dir * 0.5; e.vy = Math.min(e.vy + 0.4, 6);
      if (moveX(e)) e.dir = -e.dir;
      moveY(e);
      if (e.on) {
        const fxp = e.dir > 0 ? e.x + e.w + 1 : e.x - 1;
        if (!isSolid(tile(Math.floor(fxp / TS), Math.floor((e.y + e.h + 2) / TS)))) e.dir = -e.dir;
      }
    }
    if (P.x < e.x + e.w && P.x + P.w > e.x && P.y < e.y + e.h && P.y + P.h > e.y) {
      if (e.type === 'walk' && P.vy > 0.5 && (P.y + P.h - e.y) < 10) {
        e.squashed = true; e.squash = 30; P.vy = inp.jump ? -6.2 : -3.8; combo++;
        const pts = 100 * Math.min(8, 1 << (combo - 1)); addScore(pts); floatText(String(pts), e.x, e.y - 8); sfx.stomp(); vibrate(15);
        spark(e.x + 7, e.y + 8, '#c9a06a', 6);
      } else hurt();
    }
  }
  enemies = enemies.filter(e => !e.gone);
}
function updateItems() {
  for (const it of items) {
    if (it.emerge > 0) { it.y -= 1; it.emerge--; continue; }
    it.vx = it.dirv * 0.8; it.vy = Math.min(it.vy + 0.4, 6);
    if (moveX(it)) it.dirv = -it.dirv;
    moveY(it);
    if (it.y > VH + 20) it.gone = true;
    if (P.x < it.x + it.w && P.x + P.w > it.x && P.y < it.y + it.h && P.y + P.h > it.y) {
      it.gone = true; P.power = true; P.inv = Math.max(P.inv, 30); addScore(200); floatText('SHIELD', P.x - 6, P.y - 10); sfx.power();
      spark(P.x + 6, P.y + 6, '#ffd23a', 12);
    }
  }
  items = items.filter(i => !i.gone);
}
function collectCoins() {
  for (const c of coinsL) {
    if (c.got) continue;
    if (P.x < c.x + 6 && P.x + P.w > c.x - 6 && P.y < c.y + 7 && P.y + P.h > c.y - 7) {
      c.got = true; addCoin(); sfx.coin(); spark(c.x, c.y, '#ffd23a', 5);
    }
  }
}
function updatePlay() {
  if (++timeAcc >= 60) { timeAcc = 0; if (--timeLeft <= 0) { timeLeft = 0; die(); return; } }
  if (banner > 0) banner--;
  updatePlayer();
  if (state !== 'play') return;
  updateEnemies(); updateItems(); collectCoins();
  if (!cpReached && P.x > L.cp * TS) { cpReached = true; floatText('CHECKPOINT', L.cp * TS - 24, GROUND * TS - 56); sfx.life(); }
  if (state === 'play' && P.x + P.w > L.flagX + 4) startClear();
  if (P.inv > 0) P.inv--;
  const target = P.x + P.w / 2 - VW * 0.42 + P.dir * 22;
  cam.x = clamp(cam.x + (target - cam.x) * 0.12, 0, L.W * TS - VW);
}
function updateDying() {
  P.vy += 0.4; P.y += P.vy; dyingT++;
  if (dyingT > (P.y > VH ? 50 : 95)) afterDeath();
}
function updateClear(skip) {
  clearT++; P.on = true;
  if (clearPhase === 0) {
    P.y += 2; flagY = Math.min(flagY + 2.2, GROUND * TS - 24);
    if (P.y + P.h >= GROUND * TS) { P.y = GROUND * TS - P.h; clearPhase = 1; P.x = L.flagX + 10; P.vx = 1; }
  } else if (clearPhase === 1) {
    flagY = Math.min(flagY + 2.2, GROUND * TS - 24);
    P.x += 1.3; P.anim += 0.35;
    if (P.x >= L.castleX + 16) { P.hidden = true; clearPhase = 2; clearT = 0; }
  } else {
    if (timeLeft > 0) {
      if (skip) { addScore(timeLeft * 10); timeLeft = 0; }
      else { const d = Math.min(timeLeft, 3); timeLeft -= d; addScore(d * 10); if (frame % 3 === 0) sfx.tick(); }
      clearT = 0;
    } else if (clearT > 100 || skip) nextLevel();
  }
}

function step() {
  frame++; readInput();
  const tap = lastTap; lastTap = null; const ent = enterP; enterP = false;
  if (state === 'title') {
    if (ent || inp.jumpP) startGame(maxLevel > 1 ? maxLevel : 1);
    else if (tap) { if (maxLevel > 1 && tap.x < VW / 2) startGame(1); else startGame(maxLevel > 1 ? maxLevel : 1); }
    return;
  }
  if (paused) { if (tap || ent) paused = false; return; }
  if (state === 'gameover') {
    if (tap || ent || inp.jumpP) { lives = 3; score = 0; coinsN = 0; loadLevel(level, false); }
    return;
  }
  if (state === 'play') updatePlay();
  else if (state === 'dying') updateDying();
  else if (state === 'clear') updateClear(!!(tap || ent));
  updateFx();
}

/* ---------------- drawing ---------------- */
function txt(s, x, y, size = 10, col = '#fff', al = 'left', sh = 'rgba(0,0,0,.6)') {
  ctx.font = `bold ${size}px ${FONT}`; ctx.textAlign = al; ctx.textBaseline = 'top';
  if (sh) { ctx.fillStyle = sh; ctx.fillText(s, x + 1, y + 1); }
  ctx.fillStyle = col; ctx.fillText(s, x, y);
}
function rr(x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function hills(camx, par, base, col, seed) {
  ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(0, VH);
  for (let x = 0; x <= VW + 8; x += 8) {
    const wx = x + camx * par;
    ctx.lineTo(x, base - (Math.sin(wx * 0.012 + seed) * 18 + Math.sin(wx * 0.031 + seed * 2) * 8 + 14));
  }
  ctx.lineTo(VW, VH); ctx.closePath(); ctx.fill();
}
const CLOUDS = [[20, 30, 1], [130, 62, .8], [260, 24, 1.1], [380, 70, .9], [520, 40, 1], [650, 58, .8], [780, 28, 1.2]];
function drawBG(camx) {
  ctx.drawImage(skyCv, 0, 0);
  if (TH.kind === 'night') {
    for (let i = 0; i < 45; i++) {
      const a = 0.35 + 0.65 * Math.abs(Math.sin(frame * 0.03 + i));
      ctx.fillStyle = `rgba(255,255,255,${a.toFixed(2)})`; ctx.fillRect((i * 97) % VW, (i * 53) % 150, 1 + (i % 3 === 0), 1 + (i % 3 === 0));
    }
    ctx.fillStyle = '#fff6c8'; ctx.beginPath(); ctx.arc(410, 48, 16, 0, 7); ctx.fill();
    ctx.fillStyle = TH.sky[0]; ctx.beginPath(); ctx.arc(417, 43, 14, 0, 7); ctx.fill();
  } else if (TH.kind === 'dusk') {
    ctx.fillStyle = 'rgba(255,244,190,.9)'; ctx.beginPath(); ctx.arc(130, 178, 38, 0, 7); ctx.fill();
  }
  hills(camx, 0.15, 196, TH.hill[0], 1); hills(camx, 0.3, 218, TH.hill[1], 2);
  ctx.fillStyle = TH.cloud;
  for (const [x, y, s] of CLOUDS) {
    const cx = ((x - camx * 0.25) % 900 + 900) % 900 - 120;
    ctx.beginPath(); ctx.arc(cx, y, 9 * s, 0, 7); ctx.arc(cx + 12 * s, y - 5 * s, 12 * s, 0, 7); ctx.arc(cx + 26 * s, y, 9 * s, 0, 7); ctx.fill();
    ctx.fillRect(cx, y, 26 * s, 9 * s);
  }
}
function drawDecor(cx) {
  const gy = GROUND * TS, kx = L.cp * TS - cx;
  if (kx > -30 && kx < VW + 30) {
    ctx.fillStyle = '#cfd8dc'; ctx.fillRect(kx + 7, gy - 40, 2, 40);
    ctx.fillStyle = cpReached ? '#3ddc84' : '#90a4ae';
    ctx.beginPath(); ctx.moveTo(kx + 9, gy - 40); ctx.lineTo(kx + 26, gy - 33); ctx.lineTo(kx + 9, gy - 26); ctx.fill();
  }
  const fx0 = L.flagX - cx;
  if (fx0 > -80 && fx0 < VW + 80) {
    ctx.fillStyle = '#e8e8e8'; ctx.fillRect(fx0 + 7, 4 * TS, 2, gy - 4 * TS);
    ctx.fillStyle = '#ffd23a'; ctx.beginPath(); ctx.arc(fx0 + 8, 4 * TS - 3, 4, 0, 7); ctx.fill();
    ctx.fillStyle = '#ff4d5e'; ctx.beginPath(); ctx.moveTo(fx0 + 9, flagY); ctx.lineTo(fx0 + 28, flagY + 7); ctx.lineTo(fx0 + 9, flagY + 14); ctx.fill();
    const c0 = L.castleX - cx;
    ctx.fillStyle = TH.brickD; ctx.fillRect(c0, gy - 56, 48, 56);
    ctx.fillStyle = TH.brick; ctx.fillRect(c0 + 2, gy - 54, 44, 52);
    ctx.fillStyle = TH.brickD; for (let i = 0; i < 4; i++) ctx.fillRect(c0 + 2 + i * 12, gy - 62, 8, 8);
    ctx.fillStyle = '#1a1330'; ctx.fillRect(c0 + 18, gy - 22, 12, 22); ctx.beginPath(); ctx.arc(c0 + 24, gy - 22, 6, Math.PI, 0); ctx.fill();
    ctx.fillStyle = '#ffd23a'; ctx.fillRect(c0 + 8, gy - 42, 5, 7); ctx.fillRect(c0 + 35, gy - 42, 5, 7);
  }
}
function drawTiles(cx) {
  const x0 = Math.max(0, Math.floor(cx / TS)), x1 = Math.min(L.W - 1, x0 + 31);
  for (let ty = 0; ty < ROWS; ty++) for (let tx = x0; tx <= x1; tx++) {
    const v = L.t[ty * L.W + tx]; if (!v) continue;
    let s;
    switch (v) {
      case 1: s = isSolid(tile(tx, ty - 1)) ? spr.dirt : spr.grass; break;
      case 3: s = spr.brick; break;
      case 4: s = (frame >> 4) & 1 ? spr.q2 : spr.q1; break;
      case 5: s = spr.used; break;
      case 6: { const left = tile(tx - 1, ty) !== 6, top = tile(tx, ty - 1) !== 6;
        s = top ? (left ? spr.capL : spr.capR) : (left ? spr.bodyL : spr.bodyR); break; }
      default: s = spr.hard;
    }
    const b = bumps.get(ty * L.W + tx), oy = b ? -Math.sin((1 - b / 10) * Math.PI) * 6 : 0;
    ctx.drawImage(s, tx * TS - cx, Math.round(ty * TS + oy));
  }
}
function drawCoins(cx) {
  for (const c of coinsL) {
    if (c.got) continue; const x = c.x - cx; if (x < -10 || x > VW + 10) continue;
    const w = Math.abs(Math.cos((frame + c.x) * 0.07)) * 5 + 1;
    ctx.fillStyle = '#b8860b'; ctx.beginPath(); ctx.ellipse(x, c.y, w + 1, 7, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#ffd23a'; ctx.beginPath(); ctx.ellipse(x, c.y, w, 6, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#fff1a8'; ctx.fillRect(x - Math.min(1, w / 2), c.y - 3, 1, 5);
  }
}
function drawEnemy(e, cx) {
  const x = Math.round(e.x - cx), y = Math.round(e.y); if (x < -20 || x > VW + 20) return;
  ctx.save();
  if (e.dead) { ctx.translate(x + 7, y + 7); ctx.scale(1, -1); ctx.translate(-x - 7, -y - 7); }
  if (e.type === 'spike') {
    ctx.fillStyle = '#4a3a6a'; ctx.fillRect(x, y + 6, 14, 6);
    ctx.fillStyle = '#d6d6f0'; for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(x + i * 5 - 0.5, y + 6); ctx.lineTo(x + i * 5 + 2.5, y - 1); ctx.lineTo(x + i * 5 + 5.5, y + 6); ctx.fill(); }
    ctx.fillStyle = '#ff5566'; ctx.fillRect(x + 3, y + 8, 2, 2); ctx.fillRect(x + 9, y + 8, 2, 2);
  } else if (e.squashed) {
    ctx.fillStyle = '#a0522d'; ctx.fillRect(x, y + 10, 14, 4); ctx.fillStyle = '#fff'; ctx.fillRect(x + 3, y + 10, 2, 2); ctx.fillRect(x + 9, y + 10, 2, 2);
  } else {
    const f = (e.anim >> 3) & 1;
    ctx.fillStyle = '#a0522d'; ctx.fillRect(x + 1, y + 2, 12, 9); ctx.fillRect(x + 3, y, 8, 2);
    ctx.fillStyle = '#3b2412'; ctx.fillRect(x + 1 + f, y + 11, 5, 3); ctx.fillRect(x + 8 - f, y + 11, 5, 3);
    ctx.fillStyle = '#fff'; ctx.fillRect(x + 3, y + 5, 3, 3); ctx.fillRect(x + 8, y + 5, 3, 3);
    ctx.fillStyle = '#111'; ctx.fillRect(x + 4 + (e.dir > 0 ? 1 : 0), y + 6, 1, 2); ctx.fillRect(x + 9 + (e.dir > 0 ? 1 : 0), y + 6, 1, 2);
    ctx.fillStyle = '#3b2412'; ctx.fillRect(x + 3, y + 4, 4, 1); ctx.fillRect(x + 7, y + 4, 4, 1);
  }
  ctx.restore();
}
function drawItems(cx) {
  for (const it of items) {
    const x = Math.round(it.x - cx), y = Math.round(it.y);
    ctx.fillStyle = '#f5deb3'; ctx.fillRect(x + 3, y + 7, 6, 5);
    ctx.fillStyle = '#e53935'; ctx.beginPath(); ctx.arc(x + 6, y + 7, 6, Math.PI, 0); ctx.fill(); ctx.fillRect(x, y + 6, 12, 2);
    ctx.fillStyle = '#fff'; ctx.fillRect(x + 2, y + 3, 3, 3); ctx.fillRect(x + 7, y + 2, 3, 3);
  }
}
function drawHero(x, y, dir, anim, air, moving, power, dead) {
  ctx.save(); ctx.translate(x + 6, y); ctx.scale(dir, 1); ctx.translate(-6, 0);
  let l1 = 0, l2 = 0; if (air) { l1 = -1; l2 = 1; } else if (moving) { l1 = Math.round(Math.sin(anim) * 2); l2 = -l1; }
  if (power) { ctx.strokeStyle = `rgba(255,214,58,${(0.5 + 0.4 * Math.sin(frame * 0.3)).toFixed(2)})`; ctx.lineWidth = 1; ctx.strokeRect(-1.5, -1.5, 15, 17); }
  ctx.fillStyle = '#5a3216'; ctx.fillRect(2 + l1, 12, 4, 2); ctx.fillRect(7 + l2, 12, 4, 2);
  ctx.fillStyle = '#2a4d9c'; ctx.fillRect(3, 10, 6, 2);
  ctx.fillStyle = '#ff8a1f'; ctx.fillRect(2, 7, 8, 4); ctx.fillStyle = '#e56a00'; ctx.fillRect(2, 10, 8, 1);
  ctx.fillStyle = '#f4c28a'; ctx.fillRect(9, 8 + (air ? -2 : (moving ? Math.round(Math.cos(anim)) : 0)), 2, 3);
  ctx.fillStyle = '#f4c28a'; ctx.fillRect(2, 2, 8, 6);
  ctx.fillStyle = dead ? '#fff' : '#222'; ctx.fillRect(7, 4, 2, dead ? 2 : 2);
  ctx.fillStyle = '#c98f5a'; ctx.fillRect(9, 6, 2, 1);
  ctx.fillStyle = power ? '#ffd23a' : '#1fb8a8'; ctx.fillRect(1, 0, 9, 3); ctx.fillRect(7, 2, 5, 2);
  ctx.fillStyle = power ? '#fff3b0' : '#7ff0e2'; ctx.fillRect(2, 0, 3, 1);
  ctx.restore();
}
function drawPlayer(cx) {
  if (P.hidden) return;
  if (P.inv > 0 && state === 'play' && ((frame >> 2) & 1) && !P.power) return;
  drawHero(Math.round(P.x - cx), Math.round(P.y), P.dir, P.anim, !P.on, Math.abs(P.vx) > 0.2, P.power, state === 'dying');
}
function drawFx(cx) {
  for (const f of fx) {
    const x = f.x - cx, a = Math.min(1, f.life / 14);
    if (f.kind === 'rect') { ctx.fillStyle = f.col; ctx.globalAlpha = a; ctx.fillRect(Math.round(x), Math.round(f.y), f.s, f.s); ctx.globalAlpha = 1; }
    else if (f.kind === 'coin') { const w = Math.abs(Math.cos(f.life * 0.5)) * 4 + 1; ctx.fillStyle = '#ffd23a'; ctx.beginPath(); ctx.ellipse(x, f.y, w, 6, 0, 0, 7); ctx.fill(); }
    else { ctx.globalAlpha = a; txt(f.text, Math.round(x), Math.round(f.y), 8, '#fff'); ctx.globalAlpha = 1; }
  }
}
function drawHUD() {
  txt('SCORE ' + String(score).padStart(6, '0'), 8, 6, 11);
  ctx.fillStyle = '#b8860b'; ctx.beginPath(); ctx.ellipse(132, 12, 5, 6, 0, 0, 7); ctx.fill();
  ctx.fillStyle = '#ffd23a'; ctx.beginPath(); ctx.ellipse(132, 12, 4, 5, 0, 0, 7); ctx.fill();
  txt('x' + String(coinsN).padStart(2, '0'), 140, 6, 11);
  txt('LV ' + level, 188, 6, 11);
  const low = timeLeft < 30 && (frame >> 4) & 1;
  txt('TIME ' + timeLeft, 240, 6, 11, low ? '#ff6b6b' : '#fff');
  ctx.fillStyle = P.power ? '#ffd23a' : '#1fb8a8'; ctx.fillRect(322, 7, 9, 3); ctx.fillStyle = '#f4c28a'; ctx.fillRect(323, 10, 7, 5);
  txt('x' + lives, 335, 6, 11);
  if (P.power) txt('SHIELD', 360, 6, 11, '#ffd23a');
}
function overlay(a = 0.55) { ctx.fillStyle = `rgba(5,8,25,${a})`; ctx.fillRect(0, 0, VW, VH); }

function drawTitle() {
  const camx = frame * 0.6;
  TH = THEMES[0]; ctx.drawImage(skyCv, 0, 0);
  hills(camx, 0.15, 196, TH.hill[0], 1); hills(camx, 0.3, 218, TH.hill[1], 2);
  ctx.fillStyle = TH.cloud;
  for (const [x, y, s] of CLOUDS) {
    const cx = ((x - camx * 0.25) % 900 + 900) % 900 - 120;
    ctx.beginPath(); ctx.arc(cx, y, 9 * s, 0, 7); ctx.arc(cx + 12 * s, y - 5 * s, 12 * s, 0, 7); ctx.arc(cx + 26 * s, y, 9 * s, 0, 7); ctx.fill(); ctx.fillRect(cx, y, 26 * s, 9 * s);
  }
  const off = -(camx % TS);
  for (let i = 0; i < 32; i++) { ctx.drawImage(spr.grass, off + i * TS, GROUND * TS); ctx.drawImage(spr.dirt, off + i * TS, (GROUND + 1) * TS); ctx.drawImage(spr.dirt, off + i * TS, (GROUND + 2) * TS); }
  for (let i = 0; i < 4; i++) {
    const x = ((i * 190 + 60 - camx * 1) % 760 + 760) % 760 - 40, w = Math.abs(Math.cos(frame * 0.07 + i)) * 5 + 1;
    ctx.fillStyle = '#ffd23a'; ctx.beginPath(); ctx.ellipse(x, 184 - (i % 2) * 14, w, 6, 0, 0, 7); ctx.fill();
  }
  drawHero(70, GROUND * TS - 14, 1, frame * 0.3, false, true, false, false);
  ctx.font = `bold 44px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.lineJoin = 'round';
  ctx.lineWidth = 7; ctx.strokeStyle = '#6b2f00'; ctx.strokeText('PIXEL HOPPER', VW / 2, 36);
  ctx.fillStyle = '#ffd23a'; ctx.fillText('PIXEL HOPPER', VW / 2, 36);
  txt('Run, jump and stomp your way through endless levels', VW / 2, 90, 11, '#fff', 'center');
  const two = maxLevel > 1, by = 128;
  const btn = (x, w, label, hot) => {
    rr(x, by, w, 34, 8); ctx.fillStyle = hot ? '#ffd23a' : 'rgba(10,16,40,.7)'; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke();
    txt(label, x + w / 2, by + 11, 12, hot ? '#4a2a00' : '#fff', 'center', null);
  };
  if (two) { btn(70, 160, 'NEW GAME', false); btn(250, 160, 'CONTINUE  LV ' + maxLevel, true); }
  else btn(160, 160, 'TAP TO START', true);
  const touch = document.body.classList.contains('touch');
  txt(touch ? 'A = jump (hold to jump higher)    B = run' : 'Arrows / WASD move   Space jump   Shift run   P pause   M sound', VW / 2, 176, 9, '#fff', 'center');
  txt('BEST ' + String(best).padStart(6, '0'), VW / 2, 192, 10, '#fff', 'center');
}

function draw() {
  if (state === 'title') { drawTitle(); return; }
  const cx = Math.round(cam.x);
  drawBG(cx);
  ctx.fillStyle = TH.pit; ctx.fillRect(0, GROUND * TS, VW, VH - GROUND * TS);
  drawDecor(cx); drawItems(cx); drawTiles(cx); drawCoins(cx);
  for (const e of enemies) drawEnemy(e, cx);
  drawPlayer(cx); drawFx(cx); drawHUD();
  if (banner > 0 && state === 'play') {
    const a = Math.min(1, banner / 30); ctx.globalAlpha = a;
    txt('LEVEL ' + level, VW / 2, 72, 26, '#fff', 'center');
    if (level === 1) txt('Stomp enemies, bump ? blocks, reach the flag', VW / 2, 104, 10, '#fff', 'center');
    ctx.globalAlpha = 1;
  }
  if (state === 'clear' && clearPhase === 2) {
    overlay(0.35);
    txt('LEVEL CLEAR!', VW / 2, 70, 24, '#ffd23a', 'center');
    txt('FLAG BONUS  +' + flagBonus, VW / 2, 108, 11, '#fff', 'center');
    txt('TIME BONUS  ' + timeLeft + ' x 10', VW / 2, 124, 11, '#fff', 'center');
    txt('SCORE ' + String(score).padStart(6, '0'), VW / 2, 146, 12, '#fff', 'center');
  }
  if (state === 'gameover') {
    overlay(0.65);
    txt('GAME OVER', VW / 2, 66, 28, '#ff6b6b', 'center');
    txt('SCORE ' + String(score).padStart(6, '0') + '    BEST ' + String(best).padStart(6, '0'), VW / 2, 110, 11, '#fff', 'center');
    txt('Tap or press Enter to retry level ' + level, VW / 2, 140, 11, '#ffd23a', 'center');
  }
  if (paused) {
    overlay(0.6);
    txt('PAUSED', VW / 2, 88, 28, '#fff', 'center');
    txt('Tap or press P to resume', VW / 2, 126, 11, '#ffd23a', 'center');
  }
}

/* ---------------- main loop ---------------- */
let lastT = performance.now(), acc = 0;
const DT = 1000 / 60;
function loop(now) {
  acc += Math.min(100, now - lastT); lastT = now;
  while (acc >= DT) { step(); acc -= DT; }
  draw(); requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// tiny hook for automated tests
window.__ph = { genLevel, get state() { return state; }, get P() { return P; }, get L() { return L; }, get enemies() { return enemies; }, get level() { return level; }, step, startGame, inp, keys };
})();
