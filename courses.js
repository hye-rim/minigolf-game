'use strict';
// 코스 데이터. 좌표는 360 x 560 의 코스 안 (왼쪽 위가 0,0). 홀마다 tee(공 시작), hole(구멍), walls(선분), zones(모래·얼음·물·가속), movers(움직이는 장애물), par.
// par 는 tools/solve.js 가 찾은 가장 적은 타수에 맞춘 값 (test/logic.test.js 가 solutions.js 의 풀이로 확인한다).
const box = (x, y, w, h) => [[x, y, x + w, y], [x + w, y, x + w, y + h], [x + w, y + h, x, y + h], [x, y + h, x, y]];
const ring = (pts) => pts.map((p, i) => [p[0], p[1], pts[(i + 1) % pts.length][0], pts[(i + 1) % pts.length][1]]);
const line = (x1, y1, x2, y2) => [[x1, y1, x2, y2]];
const sand = (x, y, w, h) => ({ t: 'sand', x, y, w, h });
const ice = (x, y, w, h) => ({ t: 'ice', x, y, w, h });
const water = (x, y, w, h) => ({ t: 'water', x, y, w, h });
const boost = (x, y, w, h, dx, dy) => ({ t: 'boost', x, y, w, h, dx, dy });
const spin = (cx, cy, len, w, blades = 2, a0 = 0) => ({ kind: 'spin', cx, cy, len, w, blades, a0 });
// 가로 막대: y 높이에서 중심이 xa ~ xb 사이를 period 초에 한 번 왕복, 반쪽 길이 half
const hbar = (y, xa, xb, half, period, phase = 0) => ({ kind: 'slide', x1: xa, y1: y, x2: xb, y2: y, hx: half, hy: 0, period, phase });

const COURSES = [
  {
    id: 'easy', name: '초록 코스', emoji: '🌱',
    holes: [
      { name: '곧게 쭉', par: 2, tee: { x: 180, y: 470 }, hole: { x: 180, y: 90 }, walls: box(110, 40, 140, 480), zones: [] },
      { name: 'ㄱ자 길', par: 3, tee: { x: 110, y: 470 }, hole: { x: 255, y: 150 }, walls: ring([[60, 520], [60, 100], [300, 100], [300, 200], [160, 200], [160, 520]]), zones: [] },
      { name: '큰 돌', par: 3, tee: { x: 180, y: 480 }, hole: { x: 180, y: 80 }, walls: [...box(30, 40, 300, 480), ...box(130, 230, 100, 100)], zones: [] },
      { name: '지그재그', par: 3, tee: { x: 80, y: 470 }, hole: { x: 80, y: 90 }, walls: [...box(40, 40, 280, 480), ...line(40, 380, 220, 380), ...line(320, 240, 140, 240)], zones: [] },
      { name: '모래 웅덩이', par: 3, tee: { x: 180, y: 480 }, hole: { x: 180, y: 90 }, walls: [...box(60, 40, 240, 480), ...box(100, 160, 30, 30), ...box(230, 160, 30, 30)], zones: [sand(60, 270, 240, 50)] },
      { name: '연못', par: 3, tee: { x: 180, y: 470 }, hole: { x: 180, y: 90 }, walls: box(40, 40, 280, 480), zones: [water(110, 240, 140, 100)] },
      { name: '비스듬한 벽', par: 3, tee: { x: 80, y: 470 }, hole: { x: 280, y: 90 }, walls: [...box(40, 40, 280, 480), ...line(40, 330, 210, 230), ...line(320, 300, 150, 400)], zones: [] },
      { name: '얼음 길', par: 2, tee: { x: 180, y: 470 }, hole: { x: 180, y: 90 }, walls: box(100, 40, 160, 480), zones: [ice(100, 40, 160, 480)] },
      { name: '마지막 도전', par: 4, tee: { x: 70, y: 480 }, hole: { x: 290, y: 80 }, walls: [...box(30, 40, 300, 480), ...line(130, 395, 330, 395), ...line(30, 215, 230, 215)], zones: [sand(140, 240, 90, 130)] },
    ],
  },
  {
    id: 'hard', name: '모험 코스', emoji: '🌋',
    holes: [
      { name: '바람개비', par: 3, tee: { x: 180, y: 470 }, hole: { x: 180, y: 90 }, walls: box(90, 40, 180, 480), zones: [], movers: [spin(180, 280, 78, 1.6)] },
      { name: '오가는 막대', par: 4, tee: { x: 180, y: 470 }, hole: { x: 180, y: 90 }, walls: box(60, 40, 240, 480), zones: [], movers: [hbar(370, 125, 235, 60, 3), hbar(220, 235, 125, 60, 3, 0.5)] },
      { name: '얼음 다리', par: 4, tee: { x: 80, y: 470 }, hole: { x: 280, y: 90 }, walls: box(40, 40, 280, 480), zones: [water(40, 200, 120, 140), water(200, 200, 120, 140), ice(160, 200, 40, 140)] },
      { name: '밀어내는 길', par: 3, tee: { x: 180, y: 470 }, hole: { x: 300, y: 90 }, walls: box(40, 40, 280, 480), zones: [boost(40, 250, 280, 80, -1, 0)] },
      { name: '모래 미로', par: 4, tee: { x: 60, y: 470 }, hole: { x: 290, y: 90 }, walls: [...box(30, 40, 300, 480), ...line(30, 400, 250, 400), ...line(110, 300, 330, 300), ...line(30, 200, 250, 200)], zones: [sand(170, 320, 50, 60), sand(60, 220, 50, 60)] },
      { name: '쌍둥이 바람개비', par: 3, tee: { x: 180, y: 480 }, hole: { x: 180, y: 90 }, walls: box(80, 40, 200, 480), zones: [], movers: [spin(180, 370, 70, 1.8), spin(180, 200, 70, -2.1, 3)] },
      { name: '좁은 다리', par: 3, tee: { x: 195, y: 490 }, hole: { x: 290, y: 80 }, walls: box(40, 40, 280, 480), zones: [water(40, 190, 130, 330), water(220, 190, 100, 330)] },
      { name: '열리는 문', par: 4, tee: { x: 180, y: 480 }, hole: { x: 180, y: 90 }, walls: [...box(40, 40, 280, 480), ...line(40, 260, 140, 260), ...line(220, 260, 320, 260)], zones: [], movers: [hbar(260, 110, 250, 50, 4)] },
      { name: '큰 모험', par: 4, tee: { x: 70, y: 490 }, hole: { x: 80, y: 80 }, walls: box(30, 40, 300, 480), zones: [water(30, 270, 120, 90), sand(220, 150, 110, 90)], movers: [spin(210, 420, 60, 1.7), hbar(130, 100, 260, 55, 3.5)] },
    ],
  },
];
if (typeof module !== 'undefined') module.exports = COURSES;
