'use strict';

// 미니골프: 규칙과 물리만 모아 둔 파일 (그리기·입력 없음). 브라우저·시험(Node)이 같이 쓴다.
//
// - 위에서 내려다본 코스(360 x 560)에 공과 홀이 있다. 공을 쳐서 홀에 넣으면 그 홀이 끝나고, 친 횟수(타수)가 점수다
// - 공은 고정 간격(1/240초)으로 움직인다: 잔디·모래·얼음마다 마찰이 다르고, 벽에는 튕기고(반발 0.82), 물에 빠지면 1타를 더하고 직전 위치로 돌아간다
// - 홀 가까이(홀 반지름 안)를 지나가는 공의 속도가 CAPTURE 보다 느리면 들어가고, 빠르면 그냥 지나간다
// - 움직이는 장애물: 돌아가는 바람개비(spin) · 왔다 갔다 하는 막대(slide). 시간(st.t)만으로 위치가 정해지므로 같은 샷이면 결과도 같다
const LOGIC_GOLF = (() => {
const W = 360, H = 560;
const BALL_R = 6, HOLE_R = 11;
const DT = 1 / 240;
const MAX_SPEED = 520;               // 힘 100% 일 때 첫 속도 (단위/초)
const STOP_SPEED = 7;                // 이보다 느려지면 멈춘 것
const CAPTURE = 300;                 // 홀 위를 지나갈 때 이보다 느리면 들어간다
const REST = 0.82;                   // 벽 반발 계수
const MAX_STROKES = 8;               // 이만큼 쳐도 못 넣으면 그 홀은 8타로 끝
const FRIC = { grass: 1.15, sand: 5.2, ice: 0.5 };   // 속도가 거리에 비례해 줄어드는 정도 (1/초)
const BOOST_ACCEL = 520;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------- 상태 ----------
// def: courses.js 의 홀 정의 { tee, hole, walls: [[x1,y1,x2,y2]...], zones: [...], movers: [...] }
function newHole(def) {
  return {
    def,
    ball: { x: def.tee.x, y: def.tee.y, vx: 0, vy: 0 },
    last: { x: def.tee.x, y: def.tee.y },     // 직전에 친 자리 (물에 빠지면 여기로 돌아온다)
    strokes: 0,
    mode: 'aim',                              // aim 칠 차례 · roll 굴러가는 중 · sunk 들어감 · over 8타에도 못 넣음
    t: 0,
    events: [],
  };
}
function clone(st) {
  return { ...st, ball: { ...st.ball }, last: { ...st.last }, events: [] };
}

// ---------- 움직이는 장애물 ----------
// 시각 t 의 선분들. spin 은 중심 둘레로 도는 날개, slide 는 두 지점 사이를 왔다 갔다 하는 막대
function moverSegs(m, t) {
  if (m.kind === 'spin') {
    const out = [];
    const n = m.blades || 2;
    for (let k = 0; k < n; k++) {
      const a = (m.a0 || 0) + m.w * t + (k * 2 * Math.PI) / n;
      out.push({ x1: m.cx, y1: m.cy, x2: m.cx + m.len * Math.cos(a), y2: m.cy + m.len * Math.sin(a), spin: m });
    }
    return out;
  }
  // slide: 중심이 (x1,y1) ~ (x2,y2) 사이를 period 초에 한 번 왕복. (hx,hy) 는 막대 반쪽 벡터
  const ph = t / m.period + (m.phase || 0);
  const s = (1 - Math.cos(2 * Math.PI * ph)) / 2;
  const ds = (Math.PI / m.period) * Math.sin(2 * Math.PI * ph);
  const cx = m.x1 + s * (m.x2 - m.x1), cy = m.y1 + s * (m.y2 - m.y1);
  return [{ x1: cx - m.hx, y1: cy - m.hy, x2: cx + m.hx, y2: cy + m.hy, vx: (m.x2 - m.x1) * ds, vy: (m.y2 - m.y1) * ds }];
}

// 공 b 와 선분 seg 의 충돌: 겹쳤으면 밀어내고 튕긴다. 부딪힌 세기(법선 속도)를 돌려준다 (안 부딪혔으면 0)
function collide(b, seg) {
  const dx = seg.x2 - seg.x1, dy = seg.y2 - seg.y1;
  const l2 = dx * dx + dy * dy;
  const u = l2 ? clamp(((b.x - seg.x1) * dx + (b.y - seg.y1) * dy) / l2, 0, 1) : 0;
  const cx = seg.x1 + u * dx, cy = seg.y1 + u * dy;
  let nx = b.x - cx, ny = b.y - cy;
  let d = Math.hypot(nx, ny);
  if (d >= BALL_R) return 0;
  if (d < 1e-6) { const l = Math.sqrt(l2) || 1; nx = -dy / l; ny = dx / l; } else { nx /= d; ny /= d; }
  b.x = cx + nx * BALL_R; b.y = cy + ny * BALL_R;
  let wx = 0, wy = 0;
  if (seg.spin) { wx = -seg.spin.w * (cy - seg.spin.cy); wy = seg.spin.w * (cx - seg.spin.cx); }
  else if (seg.vx !== undefined) { wx = seg.vx; wy = seg.vy; }
  const rvn = (b.vx - wx) * nx + (b.vy - wy) * ny;
  if (rvn >= 0) return 0;
  b.vx -= (1 + REST) * rvn * nx; b.vy -= (1 + REST) * rvn * ny;
  return -rvn;
}

const inRect = (z, x, y) => x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h;
function zonesAt(def, x, y) {
  let sand = false, ice = false, water = false, boost = null;
  for (const z of def.zones || []) {
    if (!inRect(z, x, y)) continue;
    if (z.t === 'sand') sand = true;
    else if (z.t === 'ice') ice = true;
    else if (z.t === 'water') water = true;
    else if (z.t === 'boost') boost = z;
  }
  return { sand, ice, water, boost };
}

// ---------- 한 칸 진행 ----------
function step(st, h = DT) {
  st.t += h;
  if (st.mode !== 'roll') return;
  const b = st.ball, def = st.def;
  const z = zonesAt(def, b.x, b.y);
  const fr = z.sand ? FRIC.sand : z.ice ? FRIC.ice : FRIC.grass;
  const k = Math.max(0, 1 - fr * h);
  b.vx *= k; b.vy *= k;
  if (z.boost) { b.vx += z.boost.dx * BOOST_ACCEL * h; b.vy += z.boost.dy * BOOST_ACCEL * h; }
  b.x += b.vx * h; b.y += b.vy * h;
  // 벽 (고정 + 움직이는 것). 모서리에서 두 번 튕길 수 있어 두 번 확인한다
  let hit = 0;
  for (let pass = 0; pass < 2; pass++) {
    for (const w of def.walls) hit = Math.max(hit, collide(b, { x1: w[0], y1: w[1], x2: w[2], y2: w[3] }));
    for (const m of def.movers || []) for (const s of moverSegs(m, st.t)) hit = Math.max(hit, collide(b, s));
  }
  if (hit > 40) st.events.push({ type: 'wall', v: hit });
  // 물
  const z2 = zonesAt(def, b.x, b.y);
  if (z2.water) {
    st.strokes++;
    st.events.push({ type: 'water' });
    b.x = st.last.x; b.y = st.last.y; b.vx = 0; b.vy = 0;
    st.mode = st.strokes >= MAX_STROKES ? 'over' : 'aim';
    return;
  }
  // 코스 밖으로 나간 공 (벽 사이로 새는 일은 없어야 하지만 안전장치)
  if (b.x < -20 || b.x > W + 20 || b.y < -20 || b.y > H + 20) {
    st.strokes++;
    st.events.push({ type: 'water' });
    b.x = st.last.x; b.y = st.last.y; b.vx = 0; b.vy = 0;
    st.mode = st.strokes >= MAX_STROKES ? 'over' : 'aim';
    return;
  }
  const sp = Math.hypot(b.vx, b.vy);
  // 홀
  if (Math.hypot(b.x - def.hole.x, b.y - def.hole.y) < HOLE_R && sp < CAPTURE) {
    b.x = def.hole.x; b.y = def.hole.y; b.vx = 0; b.vy = 0;
    st.mode = 'sunk';
    st.events.push({ type: 'sunk' });
    return;
  }
  if (sp < STOP_SPEED && !z2.boost) {
    b.vx = 0; b.vy = 0;
    st.mode = st.strokes >= MAX_STROKES ? 'over' : 'aim';
    st.events.push({ type: 'stop' });
  }
}

// 칠 차례에 움직이는 장애물만 시간을 보낸다
function idle(st, h = DT) { st.t += h; }

// angle: 공이 날아갈 방향(라디안, 0 이 오른쪽, 시계 방향이 +), power: 0~1
function shoot(st, angle, power) {
  if (st.mode !== 'aim' || !Number.isFinite(angle) || !Number.isFinite(power) || power <= 0) return false;
  const p = clamp(power, 0, 1);
  st.last = { x: st.ball.x, y: st.ball.y };
  st.ball.vx = Math.cos(angle) * MAX_SPEED * p;
  st.ball.vy = Math.sin(angle) * MAX_SPEED * p;
  st.strokes++;
  st.mode = 'roll';
  st.events.push({ type: 'hit', power: p });
  return true;
}

// 멈출 때까지(또는 maxSec 초) 돌린다
function settle(st, maxSec = 30) {
  const n = Math.round(maxSec / DT);
  for (let i = 0; i < n && st.mode === 'roll'; i++) step(st);
  return st.mode;
}

// 미리 보기: 이 샷을 쳤을 때의 길. 점 목록과 결과를 돌려준다 (st 는 바뀌지 않는다)
function trace(st, angle, power, seconds = 1.2, every = 8) {
  const c = clone(st);
  if (!shoot(c, angle, power)) return { pts: [], end: null, mode: c.mode };
  const pts = [{ x: c.ball.x, y: c.ball.y }];
  const n = Math.round(seconds / DT);
  for (let i = 1; i <= n && c.mode === 'roll'; i++) {
    step(c);
    if (i % every === 0) pts.push({ x: c.ball.x, y: c.ball.y });
  }
  pts.push({ x: c.ball.x, y: c.ball.y });
  return { pts, end: { x: c.ball.x, y: c.ball.y }, mode: c.mode };
}

// 점수 이름
function scoreName(strokes, par) {
  if (strokes === 1) return '홀인원!';
  const d = strokes - par;
  if (d <= -3) return '알바트로스';
  if (d === -2) return '이글';
  if (d === -1) return '버디';
  if (d === 0) return '파';
  if (d === 1) return '보기';
  if (d === 2) return '더블 보기';
  return `+${d}`;
}
// 별: 파보다 적으면(홀인원 포함) 3개, 파면 2개, 그보다 많으면 1개
function starsFor(strokes, par) {
  if (strokes === 1 || strokes < par) return 3;
  return strokes === par ? 2 : 1;
}

return { W, H, BALL_R, HOLE_R, DT, MAX_SPEED, STOP_SPEED, CAPTURE, REST, MAX_STROKES, FRIC, BOOST_ACCEL, newHole, clone, moverSegs, collide, zonesAt, step, idle, shoot, settle, trace, scoreName, starsFor };
})();
if (typeof module !== 'undefined') module.exports = LOGIC_GOLF;
