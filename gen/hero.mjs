// Draws a trefoil knot in text, wrapped in this file's own source, and writes it as one animated SVG.
// No script, GIF or video ends up in the output: every frame is plain <text>.
import { readFileSync, writeFileSync } from 'node:fs';

const OUT = process.argv[2] ?? 'out/hero.svg';
const TAU = Math.PI * 2;
const CANVAS = { w: 1000, h: 440 };
const GRID = { cols: 130, rows: 48, cellW: 5, cellH: 9, left: 338, top: 4 };
const FRAMES = 36;
const FPS = 11;
const TUBE_RADIUS = 0.44;
const TILT = 0.62;
const VIEW = { camera: 9.5, scale: 12.2 };
const TEXT_PERIOD = 108;              // characters per third of the knot, so the texture shares its 3-fold symmetry
const TEXT_ROWS = 14;                 // lines of code around the tube
const SCROLL_PER_FRAME = TEXT_PERIOD / FRAMES;
const SAMPLES = { u: 9000, v: 200 };
const LIGHT = normalize([-0.45, 0.62, 0.64]);
const CROSSING_GAP = 0.3;             // a cell this far behind a neighbour is left blank, so over/under crossings read
const LEVELS = [
  { id: 'hot', min: 0.72, fill: '#f4fbff' },
  { id: 'mid', min: 0.36, fill: '#4fd2ff' },
  { id: 'low', min: -1, fill: '#2f3da0' },
];

function normalize([x, y, z]) {
  const n = Math.hypot(x, y, z);
  return [x / n, y / n, z / n];
}
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const escapeXml = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

function knotPoint(t) {
  const r = 2 + Math.cos(3 * t);
  return [r * Math.cos(2 * t), r * Math.sin(2 * t), Math.sin(3 * t)];
}

function knotTangent(t) {
  const r = 2 + Math.cos(3 * t);
  const dr = -3 * Math.sin(3 * t);
  return normalize([dr * Math.cos(2 * t) - 2 * r * Math.sin(2 * t), dr * Math.sin(2 * t) + 2 * r * Math.cos(2 * t), 3 * Math.cos(3 * t)]);
}

function surface(u, v) {
  const t = u * TAU;
  const tangent = knotTangent(t);
  const normalA = normalize(cross(tangent, [0, 0, 1]));
  const normalB = cross(tangent, normalA);
  const a = v * TAU;
  const normal = [0, 1, 2].map((i) => normalA[i] * Math.cos(a) + normalB[i] * Math.sin(a));
  const centre = knotPoint(t);
  return { point: centre.map((c, i) => c + TUBE_RADIUS * normal[i]), normal };
}

// Rotating by a third of a turn maps the knot onto itself, so the loop only needs that much motion.
function view(p, spin) {
  const [c, s] = [Math.cos(spin), Math.sin(spin)];
  const x = p[0] * c - p[1] * s;
  const y = p[0] * s + p[1] * c;
  const [ct, st] = [Math.cos(TILT), Math.sin(TILT)];
  return [x, y * ct - p[2] * st, y * st + p[2] * ct];
}

function renderFrame(frame, source) {
  const spin = (frame / FRAMES) * (TAU / 3);
  const cells = new Array(GRID.cols * GRID.rows).fill(null);
  for (let iu = 0; iu < SAMPLES.u; iu += 1) {
    const u = iu / SAMPLES.u;
    for (let iv = 0; iv < SAMPLES.v; iv += 1) {
      const v = iv / SAMPLES.v;
      const { point, normal } = surface(u, v);
      const p = view(point, spin);
      const depth = VIEW.camera - p[2];
      if (depth <= 0.1) continue;
      const k = (VIEW.scale * VIEW.camera) / depth;
      const col = Math.round(GRID.cols / 2 + (p[0] * k) / (GRID.cellW / GRID.cellH) / 2);
      const row = Math.round(GRID.rows / 2 - p[1] * k / 2);
      if (col < 0 || col >= GRID.cols || row < 0 || row >= GRID.rows) continue;
      const index = row * GRID.cols + col;
      if (cells[index] && cells[index].depth <= depth) continue;
      cells[index] = { depth, u, v, normal };
    }
  }
  const layers = LEVELS.map(() => Array.from({ length: GRID.rows }, () => new Array(GRID.cols).fill(' ')));
  let glyphs = 0;
  const neighbours = [-1, 1, -GRID.cols, GRID.cols];
  cells.forEach((cell, index) => {
    if (!cell) return;
    if (neighbours.some((d) => cells[index + d] && cell.depth - cells[index + d].depth > CROSSING_GAP)) return;
    const n = view(cell.normal, spin);
    const lambert = Math.max(0, dot(n, LIGHT));
    const rim = Math.pow(1 - Math.max(0, n[2]), 3) * 0.5;
    const light = Math.min(1, 0.08 + lambert * 0.92 + rim);
    const line = Math.floor(cell.v * TEXT_ROWS);
    const along = Math.floor(((cell.u * 3) % 1) * TEXT_PERIOD);
    const at = (along + frame * SCROLL_PER_FRAME) % TEXT_PERIOD + line * 83;
    const level = LEVELS.findIndex((l) => light >= l.min);
    layers[level][Math.floor(index / GRID.cols)][index % GRID.cols] = source[at % source.length];
    glyphs += 1;
  });
  return { layers, glyphs };
}

function frameMarkup(index, { layers, glyphs }) {
  const body = LEVELS.map((level, l) => {
    const lines = layers[l].map((chars, row) => {
      const text = chars.join('');
      if (!text.trim()) return '';
      const y = GRID.top + (row + 1) * GRID.cellH - 2;
      return `<text x="${GRID.left}" y="${y}" textLength="${GRID.cols * GRID.cellW}">${escapeXml(text)}</text>`;
    });
    return `<g fill="${level.fill}">${lines.join('')}</g>`;
  }).join('');
  const number = String(index + 1).padStart(2, '0');
  const hud = `<text class="hud" x="36" y="412">frame ${number}/${FRAMES} · ${glyphs.toLocaleString('en-US')} glyphs · z-buffered</text>`;
  return `<g class="f" style="animation-delay:${(index / FPS - FRAMES / FPS).toFixed(3)}s">${body}${hud}</g>`;
}

const TERMINAL = [
  ['$ file hero.svg', '#8b95a7'],
  ['SVG Scalable Vector Graphics image', '#e6edf3'],
  ['', ''],
  ['$ grep -c "<script" hero.svg', '#8b95a7'],
  ['0', '#55d6ff'],
  ['', ''],
  ['$ ls *.gif *.mp4', '#8b95a7'],
  ['ls: no matches found', '#e6edf3'],
  ['', ''],
  ['# no gif. no video. no javascript.', '#55d6ff'],
  ['# the knot is wrapped in the', '#55d6ff'],
  ['# code that drew it.', '#55d6ff'],
];

function terminalMarkup() {
  const charW = 9;
  const typeDelay = 0.032;
  let clock = 0.5;
  const out = [];
  TERMINAL.forEach(([line, fill], row) => {
    const y = 96 + row * 22;
    [...line].forEach((ch, i) => {
      if (ch !== ' ') out.push(`<text class="t" x="${36 + i * charW}" y="${y}" fill="${fill}" style="animation-delay:${clock.toFixed(2)}s">${escapeXml(ch)}</text>`);
      clock += typeDelay;
    });
    clock += line.startsWith('$') ? 0.28 : 0.12;
  });
  return out.join('');
}

function svg(frames) {
  const loop = FRAMES / FPS;
  const css = `
    text{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,"DejaVu Sans Mono","Liberation Mono",monospace;white-space:pre}
    #knot text{font-size:8.5px;font-weight:600}
    .hud{font-size:12px;fill:#5b6578}
    .t{font-size:15px;opacity:0;animation:t .01s linear forwards}
    .f{visibility:hidden;animation:f ${loop}s steps(1,end) infinite}
    @keyframes t{to{opacity:1}}
    @keyframes f{0%{visibility:visible}${(100 / FRAMES).toFixed(3)}%,100%{visibility:hidden}}
    @media (prefers-reduced-motion:reduce){.f{animation:none}.f:first-of-type{visibility:visible}.t{animation:none;opacity:1}}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CANVAS.w} ${CANVAS.h}" role="img" aria-label="A rotating 3D knot drawn entirely in characters of source code">
<style>${css}</style>
<defs><radialGradient id="g" cx=".66" cy=".5" r=".55"><stop offset="0" stop-color="#16214a"/><stop offset="1" stop-color="#07090f"/></radialGradient></defs>
<rect width="${CANVAS.w}" height="${CANVAS.h}" rx="14" fill="url(#g)"/>
<circle cx="38" cy="34" r="6" fill="#ff5f57"/><circle cx="60" cy="34" r="6" fill="#febc2e"/><circle cx="82" cy="34" r="6" fill="#28c840"/>
<g id="knot" xml:space="preserve">${frames.join('\n')}</g>
<g>${terminalMarkup()}</g>
</svg>
`;
}

function main() {
  const source = readFileSync(new URL(import.meta.url), 'utf8').replace(/\s+/g, ' ');
  const frames = Array.from({ length: FRAMES }, (_, i) => frameMarkup(i, renderFrame(i, source)));
  const output = svg(frames);
  writeFileSync(OUT, output);
  console.log(`${OUT}: ${(output.length / 1024).toFixed(0)} KB, ${FRAMES} frames`);
}

main();
