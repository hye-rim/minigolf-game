'use strict';
// 사용: node tools/solve.js   → 홀마다 가장 적은 타수로 넣는 샷 순서를 찾아 solutions.js 에 쓴다 (빔 탐색).
// 샷 = { a: 각도(도), p: 힘, wait: 치기 전에 기다린 초 (움직이는 장애물 때문) }
const fs = require('fs');
const path = require('path');
const L = require('../logic.js');
const COURSES = require('../courses.js');

const ANGLES = []; for (let a = 0; a < 360; a += 4) ANGLES.push(a);
const POWERS = [0.3, 0.45, 0.6, 0.75, 0.9, 1];

function solveHole(def, maxDepth, beamW) {
  const waits = (def.movers && def.movers.length) ? [0, 0.4, 0.8, 1.2, 1.7, 2.3] : [0];
  let beam = [{ st: L.newHole(def), shots: [] }];
  for (let depth = 1; depth <= maxDepth; depth++) {
    const next = [];
    for (const node of beam) {
      for (const wait of waits) {
        const base = L.clone(node.st);
        for (let i = 0; i < Math.round(wait / L.DT); i++) L.idle(base);
        for (const a of ANGLES) for (const p of POWERS) {
          const st = L.clone(base);
          L.shoot(st, (a * Math.PI) / 180, p);
          L.settle(st, 12);
          const shots = node.shots.concat([{ a, p, wait }]);
          if (st.mode === 'sunk') return shots;
          if (st.mode !== 'aim') continue;
          const d = Math.hypot(st.ball.x - def.hole.x, st.ball.y - def.hole.y);
          next.push({ st, shots, d, key: Math.round(st.ball.x / 8) + ',' + Math.round(st.ball.y / 8) });
        }
      }
    }
    // 공이 홀에 가까운 순서로, 같은 자리는 하나만 남긴다
    next.sort((x, y) => x.d - y.d);
    const seen = new Set(); beam = [];
    for (const n of next) { if (seen.has(n.key)) continue; seen.add(n.key); beam.push(n); if (beam.length >= beamW) break; }
  }
  return null;
}

const out = {};
for (const c of COURSES) {
  out[c.id] = [];
  c.holes.forEach((h, i) => {
    const t0 = Date.now();
    const shots = solveHole(h, h.par + 1, 14);
    console.log(c.id, i + 1, h.name, 'par', h.par, shots ? 'solved in ' + shots.length : 'NOT SOLVED', (Date.now() - t0) + 'ms');
    out[c.id].push(shots);
  });
}
fs.writeFileSync(path.join(__dirname, '..', 'solutions.js'), '// tools/solve.js 가 찾은 풀이 (코스 id → 홀마다 샷 목록). test 가 그대로 다시 쳐서 확인한다.\nconst SOLUTIONS = ' + JSON.stringify(out) + ';\nif (typeof module !== \'undefined\') module.exports = SOLUTIONS;\n');
