'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const L = require('../logic.js');
const COURSES = require('../courses.js');
const SOLUTIONS = require('../solutions.js');

const box = (x, y, w, h) => [[x, y, x + w, y], [x + w, y, x + w, y + h], [x + w, y + h, x, y + h], [x, y + h, x, y]];
const mk = (extra = {}) => L.newHole({ tee: { x: 180, y: 470 }, hole: { x: 180, y: 90 }, walls: box(60, 40, 240, 480), zones: [], ...extra });
const UP = -Math.PI / 2;

test('a straight shot on grass stops where friction says it should', () => {
  const st = mk({ hole: { x: 60, y: 60 } });                    // hole out of the way
  L.shoot(st, UP, 0.5);
  assert.strictEqual(L.settle(st), 'aim');
  const expected = (L.MAX_SPEED * 0.5) / L.FRIC.grass;         // speed falls linearly with distance
  assert.ok(Math.abs((470 - st.ball.y) - expected) < 12, `rolled ${470 - st.ball.y}, expected ${expected}`);
  assert.strictEqual(st.strokes, 1);
});

test('bounce off a wall keeps most of the speed and flips the direction', () => {
  const st = mk({ tee: { x: 180, y: 300 }, hole: { x: 70, y: 500 } });
  L.shoot(st, 0, 0.6);                                           // straight right into the wall at x=300
  for (let i = 0; i < 4000 && st.ball.vx >= 0; i++) L.step(st);
  assert.ok(st.ball.vx < 0, 'ball turned around');
  assert.ok(Math.abs(st.ball.y - 300) < 1);
  assert.ok(st.ball.x <= 300 - L.BALL_R + 0.01, 'ball stays inside the wall');
});

test('fast shots at every angle never leave a closed box', () => {
  for (let a = 0; a < 360; a += 3) {
    const st = mk({ tee: { x: 100, y: 100 }, hole: { x: 70, y: 500 }, walls: [...box(60, 40, 240, 480), ...box(150, 250, 60, 60)] });
    L.shoot(st, (a * Math.PI) / 180, 1);
    for (let i = 0; i < 6000 && st.mode === 'roll'; i++) {
      L.step(st);
      const b = st.ball;
      assert.ok(b.x > 60 && b.x < 300 && b.y > 40 && b.y < 520, `escaped at angle ${a}: ${b.x},${b.y}`);
    }
  }
});

test('sand slows more than grass and ice slides farther', () => {
  const run = (zones) => { const st = mk({ hole: { x: 60, y: 60 }, zones }); L.shoot(st, UP, 0.5); L.settle(st); return 470 - st.ball.y; };
  const grass = run([]);
  const sand = run([{ t: 'sand', x: 60, y: 200, w: 240, h: 300 }]);
  const iceD = run([{ t: 'ice', x: 60, y: 40, w: 240, h: 480 }]);
  assert.ok(sand < grass * 0.5, `sand ${sand} grass ${grass}`);
  assert.ok(iceD > grass * 1.2 || iceD > 420, `ice ${iceD} grass ${grass}`);   // ice runs into the far wall
});

test('water costs a stroke and puts the ball back where it was hit from', () => {
  const st = mk({ hole: { x: 70, y: 60 }, zones: [{ t: 'water', x: 60, y: 250, w: 240, h: 60 }] });
  L.shoot(st, UP, 0.8);
  L.settle(st);
  assert.strictEqual(st.mode, 'aim');
  assert.strictEqual(st.strokes, 2, 'one for the shot, one for the water');
  assert.deepStrictEqual([st.ball.x, st.ball.y], [180, 470]);
  assert.ok(st.events.some((e) => e.type === 'water'));
});

test('a boost pad pushes the ball sideways', () => {
  const st = mk({ hole: { x: 70, y: 60 }, zones: [{ t: 'boost', x: 60, y: 200, w: 240, h: 150, dx: -1, dy: 0 }] });
  L.shoot(st, UP, 0.6);
  L.settle(st);
  assert.ok(st.ball.x < 150, 'pushed to the left, x=' + st.ball.x);
});

test('the hole takes a slow ball and lets a fast one roll over it', () => {
  const slow = mk();
  L.shoot(slow, UP, 0.84);                                       // dies near the hole
  assert.strictEqual(L.settle(slow), 'sunk');
  assert.deepStrictEqual([slow.ball.x, slow.ball.y], [180, 90]);
  const fast = mk({ hole: { x: 180, y: 300 } });                 // hole in the middle of the way
  L.shoot(fast, UP, 1);
  assert.notStrictEqual(L.settle(fast), 'sunk', 'a 520/s ball is too fast to drop');
  assert.ok(fast.ball.y < 300, 'it rolled past');
});

test('eight strokes without sinking end the hole', () => {
  const st = mk({ hole: { x: 70, y: 500 } });
  for (let i = 0; i < 20 && st.mode === 'aim'; i++) { L.shoot(st, 0.5, 0.1); L.settle(st); }
  assert.strictEqual(st.mode, 'over');
  assert.strictEqual(st.strokes, L.MAX_STROKES);
  assert.strictEqual(L.shoot(st, 0, 1), false, 'no shots after the hole is over');
});

test('shoot refuses bad input and shots while rolling', () => {
  const st = mk();
  assert.strictEqual(L.shoot(st, NaN, 0.5), false);
  assert.strictEqual(L.shoot(st, 0, 0), false);
  assert.strictEqual(L.shoot(st, 0, -1), false);
  assert.strictEqual(L.shoot(st, 0, Infinity), false);
  assert.strictEqual(L.shoot(st, 0, 5), true);                  // power is capped at 1
  assert.ok(Math.hypot(st.ball.vx, st.ball.vy) <= L.MAX_SPEED + 1e-6);
  assert.strictEqual(L.shoot(st, 0, 0.5), false);
  assert.strictEqual(st.strokes, 1);
});

test('the same shot gives the same result (deterministic) even with moving parts', () => {
  const def = COURSES[1].holes[0];
  const run = () => { const st = L.newHole(def); for (let i = 0; i < 500; i++) L.idle(st); L.shoot(st, UP, 0.9); L.settle(st); return JSON.stringify([st.mode, st.ball, st.strokes]); };
  assert.strictEqual(run(), run());
});

test('moving obstacles: a spinning blade turns and a bar slides', () => {
  const spin = { kind: 'spin', cx: 100, cy: 100, len: 50, w: 2, blades: 2, a0: 0 };
  const s0 = L.moverSegs(spin, 0);
  assert.strictEqual(s0.length, 2);
  assert.ok(Math.abs(s0[0].x2 - 150) < 1e-9 && Math.abs(s0[0].y2 - 100) < 1e-9);
  assert.ok(Math.abs(s0[1].x2 - 50) < 1e-6);
  const s1 = L.moverSegs(spin, Math.PI / 4);                     // quarter turn
  assert.ok(Math.abs(s1[0].x2 - 100) < 1e-6 && Math.abs(s1[0].y2 - 150) < 1e-6);
  const bar = { kind: 'slide', x1: 100, y1: 50, x2: 200, y2: 50, hx: 20, hy: 0, period: 4, phase: 0 };
  const b0 = L.moverSegs(bar, 0)[0], b2 = L.moverSegs(bar, 2)[0], b4 = L.moverSegs(bar, 4)[0];
  assert.ok(Math.abs((b0.x1 + b0.x2) / 2 - 100) < 1e-9);
  assert.ok(Math.abs((b2.x1 + b2.x2) / 2 - 200) < 1e-9);
  assert.ok(Math.abs((b4.x1 + b4.x2) / 2 - 100) < 1e-9);
});

test('a blade knocks a ball that sits in its way', () => {
  const st = mk({ hole: { x: 70, y: 60 }, movers: [{ kind: 'spin', cx: 180, cy: 300, len: 80, w: 1.5, blades: 2, a0: 0 }] });
  st.ball.x = 200; st.ball.y = 330; st.last = { x: 200, y: 330 };
  L.shoot(st, Math.PI / 2, 0.05);                                // slow, heading into the sweep of the blade
  st.ball.vy = -40; st.ball.vx = 0;                              // heading up into the blade's sweep
  let moved = false;
  for (let i = 0; i < 6000 && st.mode === 'roll'; i++) { L.step(st); if (st.ball.vy > 0 || Math.abs(st.ball.vx) > 10) moved = true; }
  assert.ok(moved, 'the blade changed the ball direction');
});

test('trace does not change the state and matches the real shot on a static hole', () => {
  const st = L.newHole(COURSES[0].holes[2]);
  const before = JSON.stringify([st.ball, st.strokes, st.mode, st.t]);
  const tr = L.trace(st, -1.2, 0.8, 8);
  assert.strictEqual(JSON.stringify([st.ball, st.strokes, st.mode, st.t]), before);
  L.shoot(st, -1.2, 0.8); L.settle(st);
  assert.ok(Math.hypot(tr.end.x - st.ball.x, tr.end.y - st.ball.y) < 1e-6);
  assert.ok(tr.pts.length > 2);
});

test('score names and stars', () => {
  assert.strictEqual(L.scoreName(1, 3), '홀인원!');
  assert.strictEqual(L.scoreName(2, 4), '이글');
  assert.strictEqual(L.scoreName(2, 3), '버디');
  assert.strictEqual(L.scoreName(3, 3), '파');
  assert.strictEqual(L.scoreName(4, 3), '보기');
  assert.strictEqual(L.scoreName(5, 3), '더블 보기');
  assert.strictEqual(L.scoreName(7, 3), '+4');
  assert.strictEqual(L.starsFor(1, 2), 3);
  assert.strictEqual(L.starsFor(2, 3), 3);
  assert.strictEqual(L.starsFor(3, 3), 2);
  assert.strictEqual(L.starsFor(5, 3), 1);
});

// distance from point to segment
function dseg(x, y, w) {
  const dx = w[2] - w[0], dy = w[3] - w[1], l2 = dx * dx + dy * dy;
  const u = l2 ? Math.max(0, Math.min(1, ((x - w[0]) * dx + (y - w[1]) * dy) / l2)) : 0;
  return Math.hypot(x - (w[0] + u * dx), y - (w[1] + u * dy));
}

test('every hole is well formed: tee and hole are on dry land inside the walls', () => {
  assert.strictEqual(COURSES.length, 2);
  for (const c of COURSES) {
    assert.strictEqual(c.holes.length, 9, c.id);
    c.holes.forEach((h, i) => {
      const id = `${c.id} ${i + 1}`;
      assert.ok(h.par >= 2 && h.par <= 5, id + ' par');
      for (const p of [h.tee, h.hole]) {
        assert.ok(p.x > 20 && p.x < L.W - 20 && p.y > 20 && p.y < L.H - 20, id + ' inside the field');
        const z = L.zonesAt(h, p.x, p.y);
        assert.ok(!z.water && !z.sand && !z.boost, id + ' tee/hole on dry, flat ground');
        for (const w of h.walls) assert.ok(dseg(p.x, p.y, w) > L.BALL_R + 4, id + ' too close to a wall');
        for (const m of h.movers || []) for (const t of [0, 0.5, 1, 1.5, 2, 3, 4]) for (const s of L.moverSegs(m, t)) assert.ok(dseg(p.x, p.y, [s.x1, s.y1, s.x2, s.y2]) > L.BALL_R + 2, id + ' mover over tee/hole');
      }
      assert.ok(Math.hypot(h.tee.x - h.hole.x, h.tee.y - h.hole.y) > 80, id + ' tee and hole too close');
    });
  }
});

test('every hole can be won: the stored solution works and par is fair (solution + 1, +2 with moving parts)', () => {
  for (const c of COURSES) {
    c.holes.forEach((h, i) => {
      const id = `${c.id} ${i + 1} ${h.name}`;
      const shots = SOLUTIONS[c.id][i];
      assert.ok(shots && shots.length, id + ' has no solution');
      const st = L.newHole(h);
      for (const s of shots) {
        for (let k = 0; k < Math.round((s.wait || 0) / L.DT); k++) L.idle(st);
        assert.ok(L.shoot(st, (s.a * Math.PI) / 180, s.p), id + ' shot refused');
        L.settle(st, 12);
      }
      assert.strictEqual(st.mode, 'sunk', id + ' did not sink');
      assert.strictEqual(st.strokes, shots.length, id + ' stroke count (water?)');
      const extra = (h.movers && h.movers.length) ? 2 : 1;
      assert.ok(h.par >= shots.length + 1 && h.par <= shots.length + extra + (shots.length === 1 ? 1 : 0), `${id}: par ${h.par} vs solution ${shots.length}`);
    });
  }
});
