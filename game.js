'use strict';
// 오락실 튜토리얼이 '진짜로 일어난 일'을 알아채는 신호 (arcade/public/tutorial.js 가 듣는다. 튜토리얼이 아니면 아무도 안 듣는다)
const tutorialSignal = (type) => window.dispatchEvent(new CustomEvent('arcade:tutorial', { detail: { type } }));

// 미니골프: 화면·입력·소리. 규칙과 물리는 logic.js (LOGIC_GOLF), 코스는 courses.js (COURSES)
(() => {
const L = LOGIC_GOLF;
const $ = (id) => document.getElementById(id);
const BEST_KEY = 'minigolfBest', COURSE_BEST = 'minigolfCourse_';
const PULL_FULL = 95;                                      // 이만큼(코스 단위) 끌면 힘 100%
const T = { banner: 1300, between: 1000 };                 // 시간(ms). 시험용으로 줄일 수 있다
const MASK = 8;                                            // 코스 바닥을 그릴 칸 크기

// ---------- 저장소 ----------
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
};
function loadBest() {
  let b = {};
  try { b = JSON.parse(store.get(BEST_KEY)) || {}; } catch (_) {}
  for (const c of COURSES) { if (!Array.isArray(b[c.id])) b[c.id] = []; while (b[c.id].length < c.holes.length) b[c.id].push(null); }
  return b;
}
let best = loadBest();                                     // { 코스 id: [홀마다 가장 적은 타수 또는 null] }
const holeStars = (ci, hi) => { const s = best[COURSES[ci].id][hi]; return s ? L.starsFor(s, COURSES[ci].holes[hi].par) : 0; };
const totalStars = () => COURSES.reduce((a, c, ci) => a + c.holes.reduce((b, _, hi) => b + holeStars(ci, hi), 0), 0);
const saveBest = () => { store.set(BEST_KEY, JSON.stringify(best)); store.set('minigolfStars', String(totalStars())); };
let aid = store.get('minigolfAid') !== '0';                // 보조선 (튕김까지 미리 보여 줌)

// ---------- 소리 ----------
let audio = null;
let muted = store.get('minigolfMuted') === '1';
function tone(freq, dur, type = 'sine', vol = 0.09, slide = 0) {
  if (muted) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const t = audio.currentTime;
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(audio.destination);
    o.start(t);
    o.stop(t + dur);
  } catch (_) {}
}
const seq = (notes, step, type = 'triangle', vol = 0.09) => notes.forEach((f, i) => setTimeout(() => tone(f, step * 0.0009, type, vol), i * step));
const sfx = {
  hit: (p) => tone(180 + 160 * p, 0.07, 'triangle', 0.1 + 0.05 * p),
  wall: (v) => tone(300 + Math.min(300, v), 0.04, 'square', Math.min(0.07, 0.015 + v / 8000)),
  water: () => tone(500, 0.28, 'sine', 0.08, -380),
  sunk: () => seq([523, 659, 784], 90, 'triangle', 0.1),
  good: () => seq([523, 659, 784, 1047], 110, 'triangle', 0.1),
  ok: () => seq([440, 523], 100, 'triangle', 0.08),
  bad: () => seq([300, 220], 120, 'sawtooth', 0.05),
  pick: () => tone(660, 0.05, 'triangle', 0.06),
};
function toggleMute() { muted = !muted; store.set('minigolfMuted', muted ? '1' : '0'); $('muteBtn').textContent = muted ? '🔇' : '🔊'; }
$('muteBtn').onclick = (e) => { e.currentTarget.blur(); toggleMute(); };
$('muteBtn').textContent = muted ? '🔇' : '🔊';

// ---------- 상태 ----------
let ci = 0, hi = 0;                                        // 코스 · 홀 번호
let scores = [];                                           // 이번 라운드의 홀별 타수 (아직 안 친 홀은 null)
let st = null;                                             // 지금 홀의 물리 상태
let phase = 'title';                                       // title · play · between · card
let banner = null;                                         // { text, sub, until }
let aim = null;                                            // 끌고 있는 중 { sx, sy, angle, power }
let finished = false;                                      // 이 홀의 결과를 이미 처리했는가
let mask = null;                                           // 바닥을 그릴 칸 (코스 안쪽)
let heldOnce = false;
const course = () => COURSES[ci];
const defOf = () => COURSES[ci].holes[hi];

// ---------- 코스 바닥 (벽으로 둘러싸인 안쪽) ----------
function buildMask(def) {
  const cols = Math.ceil(L.W / MASK), rows = Math.ceil(L.H / MASK);
  const blocked = new Uint8Array(cols * rows);
  const dseg = (x, y, w) => {
    const dx = w[2] - w[0], dy = w[3] - w[1], l2 = dx * dx + dy * dy;
    const u = l2 ? Math.max(0, Math.min(1, ((x - w[0]) * dx + (y - w[1]) * dy) / l2)) : 0;
    return Math.hypot(x - (w[0] + u * dx), y - (w[1] + u * dy));
  };
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x = c * MASK + MASK / 2, y = r * MASK + MASK / 2;
    for (const w of def.walls) if (dseg(x, y, w) < 3.2) { blocked[r * cols + c] = 1; break; }
  }
  const inside = new Uint8Array(cols * rows);
  const queue = [];
  const seed = (p) => { const c = Math.floor(p.x / MASK), r = Math.floor(p.y / MASK); if (!blocked[r * cols + c] && !inside[r * cols + c]) { inside[r * cols + c] = 1; queue.push(r * cols + c); } };
  seed(def.tee); seed(def.hole);
  while (queue.length) {
    const i = queue.pop(), c = i % cols, r = (i / cols) | 0;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nc = c + dc, nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const j = nr * cols + nc;
      if (!blocked[j] && !inside[j]) { inside[j] = 1; queue.push(j); }
    }
  }
  return { cols, rows, inside };
}

// ---------- 그리기 ----------
const canvas = $('board'), ctx = canvas.getContext('2d');
let scale = 1, dpr = 1;
function layout() {
  const availW = Math.max(120, Math.min($('boardBox').clientWidth || 340, 420) - 8);
  const availH = Math.max(200, innerHeight - 196);
  scale = Math.min(availW / L.W, availH / L.H);
  dpr = Math.min(3, window.devicePixelRatio || 1);
  const cssW = Math.round(L.W * scale), cssH = Math.round(L.H * scale);
  canvas.style.width = cssW + 'px'; canvas.style.height = cssH + 'px';
  canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
}
function wallPath(w) { ctx.moveTo(w[0], w[1]); ctx.lineTo(w[2], w[3]); }
function draw(now = performance.now()) {
  if (!st) return;
  const def = st.def;
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
  ctx.fillStyle = '#1f5a2a'; ctx.fillRect(0, 0, L.W, L.H);
  // 바닥
  if (mask) for (let r = 0; r < mask.rows; r++) for (let c = 0; c < mask.cols; c++) {
    if (!mask.inside[r * mask.cols + c]) continue;
    ctx.fillStyle = ((r >> 1) + (c >> 1)) % 2 ? '#5fb85a' : '#68c162';
    ctx.fillRect(c * MASK, r * MASK, MASK + 0.6, MASK + 0.6);
  }
  // 구역
  for (const z of def.zones || []) {
    if (z.t === 'sand') { ctx.fillStyle = '#e8cf8a'; ctx.fillRect(z.x, z.y, z.w, z.h); ctx.fillStyle = 'rgba(160,120,50,.35)'; for (let x = z.x + 5; x < z.x + z.w; x += 11) for (let y = z.y + 5 + ((x / 11) % 2 ? 5 : 0); y < z.y + z.h; y += 11) ctx.fillRect(x, y, 2, 2); }
    else if (z.t === 'ice') { ctx.fillStyle = 'rgba(190,235,255,.82)'; ctx.fillRect(z.x, z.y, z.w, z.h); ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.lineWidth = 1.5; ctx.beginPath(); for (let k = -z.h; k < z.w; k += 26) { ctx.moveTo(Math.max(z.x, z.x + k), Math.max(z.y, z.y - Math.min(0, k))); ctx.lineTo(Math.min(z.x + z.w, z.x + k + z.h), Math.min(z.y + z.h, z.y + z.h - Math.max(0, -k) + (k > 0 ? 0 : 0))); } ctx.stroke(); }
    else if (z.t === 'water') {
      ctx.fillStyle = '#2f86dc'; ctx.fillRect(z.x, z.y, z.w, z.h);
      ctx.strokeStyle = 'rgba(255,255,255,.45)'; ctx.lineWidth = 1.6; ctx.beginPath();
      for (let y = z.y + 9; y < z.y + z.h; y += 16) for (let x = z.x + 6; x < z.x + z.w - 12; x += 24) { const o = Math.sin(now / 500 + x * 0.05 + y) * 2; ctx.moveTo(x, y + o); ctx.quadraticCurveTo(x + 6, y - 4 + o, x + 12, y + o); }
      ctx.stroke();
    } else if (z.t === 'boost') {
      ctx.fillStyle = 'rgba(255,210,63,.35)'; ctx.fillRect(z.x, z.y, z.w, z.h);
      ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      const off = ((now / 18) % 36);
      const hz = z.dx !== 0;
      ctx.save(); ctx.beginPath(); ctx.rect(z.x, z.y, z.w, z.h); ctx.clip();
      for (let k = -1; k < (hz ? z.w : z.h) / 36 + 1; k++) {
        for (let cross = 12; cross < (hz ? z.h : z.w); cross += 26) {
          const p = (k * 36 + off) * (z.dx + z.dy > 0 ? 1 : -1) + ((z.dx + z.dy) < 0 ? (hz ? z.w : z.h) : 0);
          const px = hz ? z.x + p : z.x + cross, py = hz ? z.y + cross : z.y + p, d = hz ? z.dx : z.dy;
          ctx.beginPath();
          if (hz) { ctx.moveTo(px - 5 * d, py - 6); ctx.lineTo(px + 3 * d, py); ctx.lineTo(px - 5 * d, py + 6); }
          else { ctx.moveTo(px - 6, py - 5 * d); ctx.lineTo(px, py + 3 * d); ctx.lineTo(px + 6, py - 5 * d); }
          ctx.stroke();
        }
      }
      ctx.restore();
    }
  }
  // 홀 (구멍 + 깃발)
  const h = def.hole;
  ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(h.x, h.y, L.HOLE_R, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.beginPath(); ctx.arc(h.x - 3, h.y - 3, 3.5, 0, Math.PI * 2); ctx.fill();
  if (st.mode !== 'sunk') {
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(h.x, h.y); ctx.lineTo(h.x, h.y - 34); ctx.stroke();
    ctx.fillStyle = '#ff4d6d'; ctx.beginPath(); ctx.moveTo(h.x, h.y - 34); ctx.lineTo(h.x + 20, h.y - 28 + Math.sin(now / 220) * 1.5); ctx.lineTo(h.x, h.y - 21); ctx.closePath(); ctx.fill();
  }
  // 출발 표시
  ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 2; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.arc(def.tee.x, def.tee.y, 11, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
  // 벽
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = '#3d2410'; ctx.lineWidth = 11; ctx.beginPath(); for (const w of def.walls) wallPath(w); ctx.stroke();
  ctx.strokeStyle = '#a56a35'; ctx.lineWidth = 7; ctx.beginPath(); for (const w of def.walls) wallPath(w); ctx.stroke();
  ctx.strokeStyle = '#c98a4e'; ctx.lineWidth = 2; ctx.beginPath(); for (const w of def.walls) wallPath(w); ctx.stroke();
  // 움직이는 장애물
  for (const m of def.movers || []) {
    const segs = L.moverSegs(m, st.t);
    ctx.strokeStyle = '#4a1230'; ctx.lineWidth = 11; ctx.beginPath(); for (const s of segs) { ctx.moveTo(s.x1, s.y1); ctx.lineTo(s.x2, s.y2); } ctx.stroke();
    ctx.strokeStyle = '#ff5fa2'; ctx.lineWidth = 7; ctx.beginPath(); for (const s of segs) { ctx.moveTo(s.x1, s.y1); ctx.lineTo(s.x2, s.y2); } ctx.stroke();
    if (m.kind === 'spin') { ctx.fillStyle = '#ffd23f'; ctx.strokeStyle = '#4a1230'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(m.cx, m.cy, 8, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
  }
  // 조준
  const b = st.ball;
  if (aim && aim.power > 0.02 && st.mode === 'aim') {
    const ca = Math.cos(aim.angle), sa = Math.sin(aim.angle);
    if (aid) {
      const tr = L.trace(st, aim.angle, aim.power, 2.4, 5);
      ctx.fillStyle = 'rgba(255,255,255,.9)';
      for (let i = 1; i < tr.pts.length; i++) { ctx.beginPath(); ctx.arc(tr.pts[i].x, tr.pts[i].y, 2.2, 0, Math.PI * 2); ctx.fill(); }
      if (tr.end) { ctx.strokeStyle = 'rgba(255,255,255,.95)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(tr.end.x, tr.end.y, 7, 0, Math.PI * 2); ctx.stroke(); }
    }
    const len = 26 + aim.power * 70;
    ctx.strokeStyle = `hsl(${120 - 120 * aim.power} 90% 55%)`; ctx.lineWidth = 5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(b.x + ca * 12, b.y + sa * 12); ctx.lineTo(b.x + ca * (12 + len), b.y + sa * (12 + len)); ctx.stroke();
    ctx.fillStyle = ctx.strokeStyle; ctx.beginPath(); ctx.moveTo(b.x + ca * (24 + len), b.y + sa * (24 + len)); ctx.lineTo(b.x + ca * (10 + len) - sa * 8, b.y + sa * (10 + len) + ca * 8); ctx.lineTo(b.x + ca * (10 + len) + sa * 8, b.y + sa * (10 + len) - ca * 8); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(b.x, b.y, 14, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * aim.power); ctx.stroke();
  }
  // 공
  if (st.mode !== 'sunk') {
    ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.beginPath(); ctx.ellipse(b.x + 2, b.y + 3, L.BALL_R, L.BALL_R * 0.8, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#2b1d52'; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.arc(b.x, b.y, L.BALL_R, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(43,29,82,.18)'; ctx.beginPath(); ctx.arc(b.x + 1.5, b.y + 1.5, L.BALL_R * 0.55, 0, Math.PI * 2); ctx.fill();
  }
  // 알림
  if (banner && now < banner.until) {
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    ctx.font = 'bold 34px Jua, sans-serif'; ctx.strokeStyle = '#2b1d52'; ctx.lineWidth = 8; ctx.fillStyle = '#ffd23f';
    ctx.strokeText(banner.text, L.W / 2, 150); ctx.fillText(banner.text, L.W / 2, 150);
    if (banner.sub) { ctx.font = 'bold 18px Jua, sans-serif'; ctx.lineWidth = 6; ctx.fillStyle = '#fff'; ctx.strokeText(banner.sub, L.W / 2, 188); ctx.fillText(banner.sub, L.W / 2, 188); }
  }
}
function render() {
  if (!st) return;
  const def = defOf();
  $('lvl').textContent = `${course().emoji} ${hi + 1}/${course().holes.length} · 파 ${def.par}`;
  $('strokes').textContent = String(st.strokes);
  $('aidBtn').textContent = aid ? '🎯 보조선 켬' : '🎯 보조선 끔';
  $('aidBtn').classList.toggle('off', !aid);
}
function say(t) { $('msg').textContent = t; }

// ---------- 창 ----------
const overlayOpen = () => !$('overlay').classList.contains('hidden');
function showOverlay(html) { $('overlay').innerHTML = html; $('overlay').classList.remove('hidden'); }
function hideOverlay() { $('overlay').classList.add('hidden'); }
const starStr = (n) => '⭐'.repeat(n) + '☆'.repeat(3 - n);

// ---------- 홀 진행 ----------
function loadHole(c, h) {
  ci = c; hi = h; finished = false; aim = null;
  st = L.newHole(defOf());
  mask = buildMask(defOf());
  phase = 'play'; hideOverlay();
  banner = { text: `${hi + 1}번 홀`, sub: `${defOf().name} · 파 ${defOf().par}`, until: performance.now() + T.banner };
  say('화면을 누르고 치고 싶은 반대쪽으로 끌었다 놓아요');
  render(); draw();
}
function startCourse(c, h = 0) {
  if (c !== ci || !scores.length || h === 0) scores = new Array(COURSES[c].holes.length).fill(null);
  loadHole(c, h);
}
function finishHole() {
  if (finished) return;
  finished = true;
  const def = defOf();
  const sunk = st.mode === 'sunk';
  const strokes = sunk ? st.strokes : L.MAX_STROKES;
  scores[hi] = strokes;
  const prev = best[course().id][hi];
  const isBest = !prev || strokes < prev;
  if (isBest) { best[course().id][hi] = strokes; saveBest(); }
  const name = sunk ? L.scoreName(strokes, def.par) : '아쉬워요';
  const stars = sunk ? L.starsFor(strokes, def.par) : 0;
  if (sunk) { tutorialSignal('sunk'); (stars === 3 ? sfx.good : sfx.ok)(); } else sfx.bad();
  banner = { text: sunk ? name : `${L.MAX_STROKES}타… 다음 홀로!`, sub: `${strokes}타 (파 ${def.par})`, until: performance.now() + T.banner + 600 };
  phase = 'between';
  setTimeout(() => {
    if (phase !== 'between') return;
    const last = hi === course().holes.length - 1;
    showOverlay(`
      <h2>${esc(name)}</h2>
      <div class="stars">${starStr(stars)}</div>
      <p><b>${esc(def.name)}</b> · ${strokes}타 (파 ${def.par})${isBest && prev ? '<br>🏆 내 최고 기록!' : ''}</p>
      <div class="col">${last ? '<button id="cardBtn">스코어카드 ▶</button>' : '<button id="nextBtn">다음 홀 ▶</button>'}<button id="againBtn" class="sub">이 홀 다시 도전</button>${last ? '' : '<button id="cardBtn" class="sub">스코어카드</button>'}</div>`);
    $('nextBtn') && ($('nextBtn').onclick = () => loadHole(ci, hi + 1));
    $('againBtn').onclick = () => loadHole(ci, hi);
    $('cardBtn').onclick = showCard;
  }, T.between + 400);
}
const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
function showCard() {
  phase = 'card';
  const c = course();
  const played = scores.filter((s) => s !== null).length;
  const total = scores.reduce((a, s) => a + (s || 0), 0);
  const parSum = c.holes.reduce((a, hh, i) => a + (scores[i] !== null ? hh.par : 0), 0);
  const diff = total - parSum;
  const full = played === c.holes.length;
  const key = COURSE_BEST + c.id;
  const prevBest = Number(store.get(key)) || 0;
  const newBest = full && (!prevBest || total < prevBest);
  if (newBest) store.set(key, String(total));
  const rows = c.holes.map((hh, i) => `<tr><td>${i + 1}</td><td class="nm">${esc(hh.name)}</td><td>${hh.par}</td><td>${scores[i] === null ? '-' : scores[i]}</td><td>${scores[i] === null ? '' : (scores[i] >= L.MAX_STROKES && best[c.id][i] !== scores[i] ? '' : '')}${scores[i] === null ? '' : esc(L.scoreName(scores[i], hh.par))}</td></tr>`).join('');
  showOverlay(`
    <h2>${c.emoji} ${esc(c.name)}</h2>
    <div class="scroll"><table><tr><th>홀</th><th>이름</th><th>파</th><th>타수</th><th>결과</th></tr>${rows}<tr class="tot"><td colspan="3">합계</td><td>${total}</td><td>${diff > 0 ? '+' : ''}${diff}</td></tr></table></div>
    <p>${full ? (newBest && prevBest ? '🏆 내 최고 합계 기록!' : `내 최고 합계 ${Math.min(total, prevBest || total)}타`) : '아직 안 친 홀이 있어요'}</p>
    <div class="col"><button id="againBtn">${full ? '코스 다시 하기' : '이어서 하기'}</button><button id="listBtn" class="sub">홀 선택</button><button id="homeBtn" class="sub">처음으로</button></div>`);
  $('againBtn').onclick = () => { if (full) startCourse(ci, 0); else { const nxt = scores.findIndex((s) => s === null); loadHole(ci, nxt); } };
  $('listBtn').onclick = () => showHoles(ci);
  $('homeBtn').onclick = showTitle;
}
let tabCourse = 0;
function showHoles(c = tabCourse) {
  tabCourse = c;
  const cc = COURSES[c];
  const stars = cc.holes.reduce((a, _, i) => a + holeStars(c, i), 0);
  showOverlay(`
    <h2>홀 선택</h2>
    <div class="tabs">${COURSES.map((x, i) => `<button data-c="${i}" class="${i === c ? 'on' : ''}">${x.emoji} ${esc(x.name)}</button>`).join('')}</div>
    <p>별 <b>${stars}</b> / ${cc.holes.length * 3}</p>
    <div class="holes">${cc.holes.map((hh, i) => `<button data-h="${i}" class="${best[cc.id][i] ? 'done' : ''}${phase !== 'title' && c === ci && i === hi ? ' cur' : ''}">${i + 1}<small>${best[cc.id][i] ? '⭐'.repeat(holeStars(c, i)) || '·' : `파 ${hh.par}`}</small></button>`).join('')}</div>
    <button id="backBtn" class="sub">닫기</button>`);
  document.querySelectorAll('#overlay .tabs button').forEach((b) => { b.onclick = () => showHoles(Number(b.dataset.c)); });
  document.querySelectorAll('#overlay .holes button').forEach((b) => { b.onclick = () => { sfx.pick(); if (c !== ci || !scores.length) scores = new Array(cc.holes.length).fill(null); loadHole(c, Number(b.dataset.h)); }; });
  $('backBtn').onclick = () => { if (phase === 'title' || !st) showTitle(); else hideOverlay(); };
}
function showTitle() {
  phase = 'title'; aim = null;
  showOverlay(`
    <h1>미니골프</h1>
    <p>공을 쳐서 <b>홀에 넣어요!</b> 적게 칠수록 좋아요</p>
    <div class="card2" style="font-size:13px">⛳ 쏘고 싶은 <b>반대쪽으로 끌었다 놓으면</b> 공이 날아가요 (많이 끌수록 세게)<br>🧱 벽에 튕기고, 🏖️ 모래는 느리고, 🧊 얼음은 미끄러워요<br>💦 물에 빠지면 1타 추가! 🌀 움직이는 장애물은 타이밍을 맞춰요<br>⭐ 파보다 적게 치면 별 세 개</div>
    <div class="courses">${COURSES.map((c, i) => `<button data-c="${i}">${c.emoji} ${esc(c.name)}<small>${c.id === 'easy' ? '쉬움' : '어려움'} · ⭐ ${c.holes.reduce((a, _, h) => a + holeStars(i, h), 0)}/${c.holes.length * 3}</small></button>`).join('')}</div>
    <button id="listBtn" class="sub">홀 선택</button>`);
  document.querySelectorAll('#overlay .courses button').forEach((b) => { b.onclick = () => { const i = Number(b.dataset.c); scores = []; startCourse(i, 0); }; });
  $('listBtn').onclick = () => showHoles(tabCourse);
}

// ---------- 입력 ----------
function worldPos(e) {
  const r = canvas.getBoundingClientRect();
  return { x: (e.clientX - r.left) / r.width * L.W, y: (e.clientY - r.top) / r.height * L.H };
}
function setAim(e) {
  const p = worldPos(e);
  const dx = aim.sx - p.x, dy = aim.sy - p.y;               // 끈 쪽의 반대가 공이 날아갈 방향
  const len = Math.hypot(dx, dy);
  aim.power = Math.min(1, len / PULL_FULL);
  if (len > 1.5) aim.angle = Math.atan2(dy, dx);
  if (aim.power > 0.12 && !heldOnce) { heldOnce = true; tutorialSignal('aim'); }
}
canvas.addEventListener('pointerdown', (e) => {
  if (phase !== 'play' || !st || st.mode !== 'aim' || overlayOpen()) return;
  e.preventDefault();
  try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
  const p = worldPos(e);
  aim = { sx: p.x, sy: p.y, angle: -Math.PI / 2, power: 0 };
});
canvas.addEventListener('pointermove', (e) => { if (aim) setAim(e); });
function release(e, cancel) {
  if (!aim) return;
  if (!cancel) setAim(e);
  const a = aim; aim = null;
  if (cancel || a.power < 0.06 || !st || st.mode !== 'aim') return;
  fire(a.angle, a.power);
}
canvas.addEventListener('pointerup', (e) => release(e, false));
canvas.addEventListener('pointercancel', (e) => release(e, true));
function fire(angle, power) {
  if (phase !== 'play' || !st || !L.shoot(st, angle, power)) return false;
  sfx.hit(power); tutorialSignal('shot'); say(''); render();
  return true;
}
$('aidBtn').onclick = (e) => { e.currentTarget.blur(); aid = !aid; store.set('minigolfAid', aid ? '1' : '0'); tutorialSignal('aid'); render(); };
$('restartBtn').onclick = (e) => { e.currentTarget.blur(); if (phase === 'play' && st && st.mode === 'aim') loadHole(ci, hi); };
$('menuBtn').onclick = (e) => { e.currentTarget.blur(); if (!overlayOpen()) showHoles(phase === 'title' ? tabCourse : ci); };
addEventListener('keydown', (e) => { if (e.ctrlKey || e.metaKey || e.altKey) return; if (e.key === 'm' || e.key === 'M') toggleMute(); });
addEventListener('resize', () => { layout(); draw(); });

// ---------- 시간 ----------
let acc = 0, lastT = performance.now();
function advance(dt) {
  if (!st) return;
  acc += Math.min(dt, 0.05);
  while (acc >= L.DT) {
    acc -= L.DT;
    if (st.mode === 'roll') L.step(st); else L.idle(st);
  }
  for (const ev of st.events.splice(0)) {
    if (ev.type === 'wall') sfx.wall(ev.v);
    else if (ev.type === 'water') { sfx.water(); say('💦 물에 빠졌어요! 1타 추가'); banner = { text: '풍덩! +1타', sub: '', until: performance.now() + 900 }; render(); }
    else if (ev.type === 'sunk') { sfx.sunk(); render(); }
    else if (ev.type === 'stop') render();
  }
  if ((st.mode === 'sunk' || st.mode === 'over') && !finished && phase === 'play') finishHole();
}
function frame(now) {
  requestAnimationFrame(frame);
  const dt = (now - lastT) / 1000; lastT = now;
  advance(dt);
  draw(now);
  if ($('strokes').textContent !== String(st ? st.strokes : 0)) render();
}

// ---------- 시작 ----------
ci = 0; hi = 0; st = L.newHole(defOf()); mask = buildMask(defOf());
layout(); render(); draw();
showTitle();
requestAnimationFrame(frame);

/* @test-hooks:start */
window.__gf = { get st() { return st; }, get phase() { return phase; }, get scores() { return scores; }, get best() { return best; }, get aid() { return aid; }, T, fire, loadHole, startCourse, showCard, showTitle, advance, COURSES, get scale() { return scale; } };
/* @test-hooks:end */
})();
