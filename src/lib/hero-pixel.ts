// Pixel portrait for the home hero, ported from the pixel tuner (~/claude-tmp/personal-site/pixel-tuner).
//
// The portrait arrives already cut out (scripts/build-hero-portrait.mjs; alpha = mask). At
// runtime: sample tile coverage and mean colour on a lattice aligned to the hero's top-left,
// preprocess and colour each tile, then draw the tiles as particles: an entrance, a slow breeze,
// a twinkle, and a pointer that scatters tiles which drift and spring back.
// Every tuned value comes from src/data/hero-pixel.json; the constants left in this file are
// the tuner's own algorithm. Where the site differs from the tuner:
// - the canvas is never filled, so the hero ground shows through (color.background and text.*
//   only styled the tuner's preview);
// - desktop / mobile placement follows the site's 900px breakpoint;
// - a touch press sends one pulse, because a touch drag belongs to page scrolling;
// - with the desktop placement the figure shrinks when needed to stay clear of the name.
// Sampling and colouring rerun only when the hero's size changes; frames only draw.
import type paramsJson from '../data/hero-pixel.json';

export type HeroPixelParams = typeof paramsJson;
type Placement = HeroPixelParams['placement']['desktop'];

const TAU = Math.PI * 2;
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const hex2 = (v: number) => v.toString(16).padStart(2, '0');
const rgbHex = (r: number, g: number, b: number) => '#' + hex2(r) + hex2(g) + hex2(b);
function hexToRgb(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
// Integer hash -> [0,1). Deterministic per lattice cell, so sprinkles and twinkles are stable.
function hash3(a: number, b: number, c: number) {
  let h = (Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1) ^ 0x5bd1e995) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function mulberry32(a: number) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Summed-area tables of the opaque (figure) pixels: count and r / g / b sums. */
export interface Source { w: number; h: number; W1: number; C: Uint32Array; R: Uint32Array; G: Uint32Array; B: Uint32Array }

export function buildSource(d: Uint8ClampedArray, w: number, h: number): Source {
  const W1 = w + 1, size = W1 * (h + 1);
  const C = new Uint32Array(size), R = new Uint32Array(size), G = new Uint32Array(size), B = new Uint32Array(size);
  for (let y = 0; y < h; y++) {
    let rc = 0, rr = 0, rg = 0, rb = 0;
    const row = (y + 1) * W1, prev = y * W1;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (d[i + 3] >= 128) { rc++; rr += d[i]; rg += d[i + 1]; rb += d[i + 2]; }
      const o = row + x + 1, q = prev + x + 1;
      C[o] = C[q] + rc; R[o] = R[q] + rr; G[o] = G[q] + rg; B[o] = B[q] + rb;
    }
  }
  return { w, h, W1, C, R, G, B };
}

/** Tiles as a struct of arrays; rest position (hx, hy) is the cell centre in hero px. */
export interface Tiles {
  n: number; tile: number; pitch: number;
  ci: Int32Array; cj: Int32Array;
  hx: Float32Array; hy: Float32Array; nx: Float32Array; ny: Float32Array;
  ox: Float32Array; oy: Float32Array; vx: Float32Array; vy: Float32Array;
  hold: Float32Array; act: Uint8Array;
  alpha0: Float32Array; raw: Float32Array;
  cape: Float32Array; phase: Float32Array; tph: Float32Array;
  visible: Uint8Array; colorId: Int32Array; alphaQ: Float32Array;
  order: Uint32Array; drawN: number; palette: string[]; activeN: number;
  isx: Float32Array; isy: Float32Array; idel: Float32Array;
  px: Float32Array; py: Float32Array;
  lookup: { i0: number; j0: number; cols: number; rows: number; idx: Int32Array };
}

/**
 * Lattice cells over the placed figure that pass the coverage test, with their mean colour.
 * `scale` shrinks the figure about its anchors (centerXPct and the bottom edge); 1 = as tuned.
 */
export function buildTiles(src: Source, P: HeroPixelParams, pl: Placement, W: number, H: number, scale = 1): Tiles | null {
  const figH = H * pl.heightPct / 100 * scale, figW = figH * src.w / src.h;
  const cx = W * pl.centerXPct / 100;
  let bottom = H * (1 + pl.bottomOffsetPct / 100);
  if (!pl.cropBottom) bottom = Math.min(bottom, H);
  const left = cx - figW / 2, top = bottom - figH;
  const tile = P.grid.tilePx, pitch = tile + P.grid.gapPx;
  const i0 = Math.floor(left / pitch), i1 = Math.ceil((left + figW) / pitch);
  const j0 = Math.floor(top / pitch), j1 = Math.ceil(bottom / pitch);
  const cols = i1 - i0, rows = j1 - j0;
  if (cols <= 0 || rows <= 0 || cols * rows > 1.5e6) return null;
  const N = cols * rows;
  const inside = new Uint8Array(N), rgb = new Float32Array(N * 3);
  const kx = src.w / figW, ky = src.h / figH;
  const full = pitch * kx * pitch * ky;
  const { W1, C, R, G, B } = src;
  const minCov = P.mask.minCoveragePct / 100;
  for (let j = 0; j < rows; j++) {
    const y0 = (j0 + j) * pitch;
    const fy0 = (y0 - top) * ky, fy1 = (y0 + pitch - top) * ky;
    if (fy1 <= 0 || fy0 >= src.h) continue;
    let sy0 = clamp(Math.round(fy0), 0, src.h), sy1 = clamp(Math.round(fy1), 0, src.h);
    if (sy1 <= sy0) { if (sy0 < src.h) sy1 = sy0 + 1; else sy0 = sy1 - 1; }
    const a = sy0 * W1, b = sy1 * W1;
    for (let i = 0; i < cols; i++) {
      const x0 = (i0 + i) * pitch;
      const fx0 = (x0 - left) * kx, fx1 = (x0 + pitch - left) * kx;
      if (fx1 <= 0 || fx0 >= src.w) continue;
      let sx0 = clamp(Math.round(fx0), 0, src.w), sx1 = clamp(Math.round(fx1), 0, src.w);
      if (sx1 <= sx0) { if (sx0 < src.w) sx1 = sx0 + 1; else sx0 = sx1 - 1; }
      const cnt = C[b + sx1] - C[b + sx0] - C[a + sx1] + C[a + sx0];
      if (!cnt || cnt / full < minCov) continue;
      const k = j * cols + i;
      inside[k] = 1;
      rgb[k * 3] = (R[b + sx1] - R[b + sx0] - R[a + sx1] + R[a + sx0]) / cnt;
      rgb[k * 3 + 1] = (G[b + sx1] - G[b + sx0] - G[a + sx1] + G[a + sx0]) / cnt;
      rgb[k * 3 + 2] = (B[b + sx1] - B[b + sx0] - B[a + sx1] + B[a + sx0]) / cnt;
    }
  }
  // Chebyshev distance (in cells) to the outside, capped at 4. The lattice bottom
  // (the source image's own cut edge) does not count as outside.
  const dist = new Uint8Array(N);
  for (let k = 0; k < N; k++) dist[k] = inside[k] ? 255 : 0;
  for (let lv = 1; lv <= 4; lv++) {
    const mark: number[] = [];
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const k = j * cols + i;
      if (dist[k] !== 255) continue;
      let edge = false;
      for (let dj = -1; dj <= 1 && !edge; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const nj = j + dj, ni = i + di;
        if (nj >= rows) continue;
        if (nj < 0 || ni < 0 || ni >= cols) { if (lv === 1) { edge = true; break; } continue; }
        if (dist[nj * cols + ni] === lv - 1) { edge = true; break; }
      }
      if (edge) mark.push(k);
    }
    for (const k of mark) dist[k] = lv;
  }
  const erode = P.mask.erodeCells, feather = P.mask.featherCells;
  const dissolve = pl.bottomDissolvePct / 100;
  const visBottom = Math.min(bottom, H);
  const guardX = W * pl.textGuardXPct / 100, ramp = W * 0.08;
  const L: number[] = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const k = j * cols + i;
    if (!inside[k]) continue;
    const dd = dist[k];
    if (dd <= erode) continue;
    let alpha = 1;
    if (feather > 0 && dd - erode <= feather) alpha = (dd - erode) / (feather + 1);
    const ci = i0 + i, cj = j0 + j;
    const hx = (ci + 0.5) * pitch, hy = (cj + 0.5) * pitch;
    if (hy - tile / 2 > H || hy + tile / 2 < 0 || hx + tile / 2 < 0 || hx - tile / 2 > W) continue;
    const nx = (hx - left) / figW, ny = (hy - top) / figH;
    if (dissolve > 0) {
      const u = (visBottom - hy) / (dissolve * figH);
      if (u < 1 && hash3(ci, cj, 7) > Math.max(0, u)) continue;
    }
    if (guardX > 0) {
      const g = (hx - (guardX - ramp)) / ramp;
      if (g <= 0) continue;
      if (g < 1) alpha *= g;
    }
    L.push(k, ci, cj, hx, hy, nx, ny, alpha);
  }
  const n = L.length / 8;
  const f32 = () => new Float32Array(n);
  const t: Tiles = {
    n, tile, pitch,
    ci: new Int32Array(n), cj: new Int32Array(n),
    hx: f32(), hy: f32(), nx: f32(), ny: f32(),
    ox: f32(), oy: f32(), vx: f32(), vy: f32(),
    hold: f32(), act: new Uint8Array(n),
    alpha0: f32(), raw: new Float32Array(n * 3),
    cape: f32(), phase: f32(), tph: f32(),
    visible: new Uint8Array(n), colorId: new Int32Array(n), alphaQ: f32(),
    order: new Uint32Array(n), drawN: 0, palette: [], activeN: 0,
    isx: f32(), isy: f32(), idel: f32(),
    px: f32(), py: f32(),
    lookup: { i0, j0, cols, rows, idx: new Int32Array(N).fill(-1) },
  };
  for (let q = 0; q < n; q++) {
    const o = q * 8, k = L[o];
    t.ci[q] = L[o + 1]; t.cj[q] = L[o + 2];
    t.hx[q] = L[o + 3]; t.hy[q] = L[o + 4];
    t.nx[q] = L[o + 5]; t.ny[q] = L[o + 6]; t.alpha0[q] = L[o + 7];
    t.raw[q * 3] = rgb[k * 3]; t.raw[q * 3 + 1] = rgb[k * 3 + 1]; t.raw[q * 3 + 2] = rgb[k * 3 + 2];
    // Wind weight: the lower body and the cape's outer sides sway more.
    const ny = t.ny[q], nx = t.nx[q];
    const sy = clamp((ny - 0.25) / 0.6, 0, 1);
    t.cape[q] = clamp(sy * sy * (3 - 2 * sy) * (0.55 + 0.9 * Math.abs(nx - 0.5)), 0, 1);
    t.phase[q] = t.hy[q] * 0.011 + t.hx[q] * 0.004;
    t.tph[q] = hash3(t.ci[q], t.cj[q], 3);
    t.lookup.idx[k] = q;
  }
  return t;
}

function kmeans(pts: Float32Array, n: number, K: number, seed: number) {
  K = Math.max(1, Math.min(K, n));
  const rnd = mulberry32(seed);
  const cen = new Float32Array(K * 3);
  const d2 = new Float32Array(n).fill(Infinity);
  const first = Math.floor(rnd() * n);
  cen.set(pts.subarray(first * 3, first * 3 + 3), 0);
  for (let c = 1; c < K; c++) { // k-means++ seeding
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const dr = pts[i * 3] - cen[(c - 1) * 3], dg = pts[i * 3 + 1] - cen[(c - 1) * 3 + 1], db = pts[i * 3 + 2] - cen[(c - 1) * 3 + 2];
      const dd = dr * dr + dg * dg + db * db;
      if (dd < d2[i]) d2[i] = dd;
      sum += d2[i];
    }
    let r = rnd() * sum, pick = n - 1;
    for (let i = 0; i < n; i++) { r -= d2[i]; if (r <= 0) { pick = i; break; } }
    cen.set(pts.subarray(pick * 3, pick * 3 + 3), c * 3);
  }
  const asg = new Uint8Array(n);
  for (let it = 0; it < 16; it++) {
    const sum = new Float64Array(K * 3), cnt = new Uint32Array(K);
    let changed = 0;
    for (let i = 0; i < n; i++) {
      let best = 0, bd = Infinity;
      for (let c = 0; c < K; c++) {
        const dr = pts[i * 3] - cen[c * 3], dg = pts[i * 3 + 1] - cen[c * 3 + 1], db = pts[i * 3 + 2] - cen[c * 3 + 2];
        const dd = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11;
        if (dd < bd) { bd = dd; best = c; }
      }
      if (asg[i] !== best || it === 0) { asg[i] = best; changed++; }
      cnt[best]++; sum[best * 3] += pts[i * 3]; sum[best * 3 + 1] += pts[i * 3 + 1]; sum[best * 3 + 2] += pts[i * 3 + 2];
    }
    for (let c = 0; c < K; c++) if (cnt[c]) { cen[c * 3] = sum[c * 3] / cnt[c]; cen[c * 3 + 1] = sum[c * 3 + 1] / cnt[c]; cen[c * 3 + 2] = sum[c * 3 + 2] / cnt[c]; }
    if (!changed) break;
  }
  return { cen, asg };
}

function gradientLUT(stops: { pos: number; color: string }[]) {
  const st = stops.map((s) => ({ pos: s.pos, rgb: hexToRgb(s.color) })).sort((a, b) => a.pos - b.pos);
  const lut = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let r: number, g: number, b: number;
    if (t <= st[0].pos) [r, g, b] = st[0].rgb;
    else if (t >= st[st.length - 1].pos) [r, g, b] = st[st.length - 1].rgb;
    else {
      let k = 0;
      while (k < st.length - 2 && t > st[k + 1].pos) k++;
      const A = st[k], Bs = st[k + 1];
      const u = Bs.pos > A.pos ? (t - A.pos) / (Bs.pos - A.pos) : 0;
      r = A.rgb[0] + (Bs.rgb[0] - A.rgb[0]) * u;
      g = A.rgb[1] + (Bs.rgb[1] - A.rgb[1]) * u;
      b = A.rgb[2] + (Bs.rgb[2] - A.rgb[2]) * u;
    }
    lut[i * 3] = r; lut[i * 3 + 1] = g; lut[i * 3 + 2] = b;
  }
  return lut;
}

/** Preprocess, dark cutoff, colour mapping, accent sprinkles and draw order. */
export function colorTiles(T: Tiles, P: HeroPixelParams) {
  const n = T.n, pp = P.preprocess, cm = P.color;
  const br = pp.brightness * 1.28;
  const cc = pp.contrast * 2.55, cf = (259 * (cc + 255)) / (255 * (259 - cc));
  const sat = pp.saturation, ig = 1 / pp.gamma;
  const pr = new Float32Array(n * 3), luma = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let r = T.raw[i * 3] + br, g = T.raw[i * 3 + 1] + br, b = T.raw[i * 3 + 2] + br;
    r = cf * (r - 128) + 128; g = cf * (g - 128) + 128; b = cf * (b - 128) + 128;
    const l0 = 0.299 * r + 0.587 * g + 0.114 * b;
    r = l0 + (r - l0) * sat; g = l0 + (g - l0) * sat; b = l0 + (b - l0) * sat;
    r = 255 * Math.pow(clamp(r, 0, 255) / 255, ig);
    g = 255 * Math.pow(clamp(g, 0, 255) / 255, ig);
    b = 255 * Math.pow(clamp(b, 0, 255) / 255, ig);
    pr[i * 3] = r; pr[i * 3 + 1] = g; pr[i * 3 + 2] = b;
    luma[i] = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  }
  // Histogram equalisation of luma (mixable): spreads a mostly dark figure across the whole
  // gradient. The mapped luma drives gradient / duotone colours and the dark cutoff.
  const eq = pp.equalizeMix;
  if (eq > 0 && n > 0) {
    const hist = new Float64Array(256);
    for (let i = 0; i < n; i++) hist[Math.round(clamp(luma[i], 0, 1) * 255)]++;
    const cdf = new Float32Array(256);
    let cum = 0;
    for (let b = 0; b < 256; b++) { cdf[b] = (cum + hist[b] / 2) / n; cum += hist[b]; }
    for (let i = 0; i < n; i++) luma[i] = luma[i] * (1 - eq) + cdf[Math.round(clamp(luma[i], 0, 1) * 255)] * eq;
  }
  for (let i = 0; i < n; i++) T.visible[i] = luma[i] >= pp.lumaCutoff ? 1 : 0;
  const out = new Uint8Array(n * 3);
  if (cm.mode === 'quantize') {
    const idx: number[] = [];
    for (let i = 0; i < n; i++) if (T.visible[i]) idx.push(i);
    const pts = new Float32Array(idx.length * 3);
    idx.forEach((ti, q) => { pts[q * 3] = pr[ti * 3]; pts[q * 3 + 1] = pr[ti * 3 + 1]; pts[q * 3 + 2] = pr[ti * 3 + 2]; });
    if (idx.length) {
      const { cen, asg } = kmeans(pts, idx.length, cm.quantizeK, 1337);
      idx.forEach((ti, q) => { const c = asg[q]; out[ti * 3] = cen[c * 3]; out[ti * 3 + 1] = cen[c * 3 + 1]; out[ti * 3 + 2] = cen[c * 3 + 2]; });
    }
  } else if (cm.mode === 'gradient' || cm.mode === 'duotone') {
    const lut = cm.mode === 'gradient'
      ? gradientLUT(cm.gradientStops)
      : gradientLUT([{ pos: 0, color: cm.duotone.shadowColor }, { pos: 1, color: cm.duotone.highlightColor }]);
    for (let i = 0; i < n; i++) {
      const q = Math.round(clamp(luma[i], 0, 1) * 255) * 3;
      out[i * 3] = lut[q]; out[i * 3 + 1] = lut[q + 1]; out[i * 3 + 2] = lut[q + 2];
    }
  } else {
    for (let i = 0; i < n * 3; i++) out[i] = pr[i];
  }
  const accRatio = cm.accent.ratioPct / 100, acc = hexToRgb(cm.accent.color);
  const map = new Map<number, number>(), palette: string[] = [];
  const keys: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!T.visible[i]) continue;
    let r = out[i * 3], g = out[i * 3 + 1], b = out[i * 3 + 2];
    if (accRatio > 0 && hash3(T.ci[i], T.cj[i], 11) < accRatio) [r, g, b] = acc;
    // 6 bits per channel is visually lossless here and keeps fillStyle switches low.
    r = (r >> 2) << 2 | (r >> 6); g = (g >> 2) << 2 | (g >> 6); b = (b >> 2) << 2 | (b >> 6);
    const key = (r << 16) | (g << 8) | b;
    let id = map.get(key);
    if (id === undefined) { id = palette.length; palette.push(rgbHex(r, g, b)); map.set(key, id); }
    T.colorId[i] = id;
    T.alphaQ[i] = Math.round(T.alpha0[i] * 16) / 16;
    keys.push(i);
  }
  keys.sort((a, b) => (T.alphaQ[b] - T.alphaQ[a]) || (T.colorId[a] - T.colorId[b]));
  T.order.set(keys);
  T.drawN = keys.length;
  T.palette = palette;
}

/** Gap kept between the name and the figure (desktop placement), in lattice steps: 2 x 8px = 16px. */
const TEXT_CLEARANCE_CELLS = 2;

/** Left edge (hero px) of the leftmost drawn tile at rest. */
function leftEdge(T: Tiles) {
  let x = Infinity;
  for (let o = 0; o < T.drawN; o++) { const v = T.hx[T.order[o]]; if (v < x) x = v; }
  return x - T.tile / 2;
}

/**
 * Coloured tiles for one placement. With `clearRight` (the name's ink right edge in hero px)
 * the figure shrinks, keeping its anchors, until its leftmost drawn tile is at least
 * TEXT_CLEARANCE_CELLS lattice steps right of it. A layout that already clears the name keeps
 * the first pass untouched, so it is tile-for-tile the tuned figure.
 */
export function placeTiles(src: Source, P: HeroPixelParams, pl: Placement, W: number, H: number, clearRight: number | null) {
  let scale = 1;
  let T = buildTiles(src, P, pl, W, H, scale);
  if (T) colorTiles(T, P);
  if (clearRight === null || !T) return { tiles: T, scale };
  const limit = clearRight + TEXT_CLEARANCE_CELLS * T.pitch;
  const cx = W * pl.centerXPct / 100;
  for (let pass = 0; pass < 8 && T && T.drawN; pass++) {
    const left = leftEdge(T);
    if (left >= limit) break;
    // Distances from cx scale with the figure. Later passes aim a little further right in
    // case the lattice snaps the edge back past the limit.
    const want = cx - limit - pass * T.pitch / 2;
    if (want <= 0) return { tiles: null, scale: 0 };
    scale *= want / (cx - left);
    T = buildTiles(src, P, pl, W, H, scale);
    if (T) colorTiles(T, P);
  }
  return { tiles: T, scale };
}

/** Start offsets and delays for the entrance (deterministic, so a replay looks the same). */
function initIntro(T: Tiles, P: HeroPixelParams, heroH: number) {
  const id = P.idle.intro, D = id.durationMs / 1000, per = D * 0.55, spread = id.spreadPx;
  const rnd = mulberry32(9001);
  for (let i = 0; i < T.n; i++) {
    const hy = T.hy[i], ny = T.ny[i];
    let sx: number, sy: number, del: number;
    if (id.style === 'rain') {
      sx = (rnd() - 0.5) * spread * 0.2; sy = -(hy + 30 + rnd() * spread * 0.6);
      del = (1 - clamp(ny, 0, 1)) * (D - per) * 0.85 + rnd() * (D - per) * 0.15;
    } else if (id.style === 'rise') {
      sx = (rnd() - 0.5) * spread * 0.2; sy = (heroH - hy) + 30 + rnd() * spread * 0.6;
      del = (1 - clamp(ny, 0, 1)) * (D - per) * 0.85 + rnd() * (D - per) * 0.15;
    } else {
      const a = rnd() * TAU, r = spread * (0.25 + 0.75 * rnd());
      sx = Math.cos(a) * r; sy = Math.sin(a) * r * 0.8 + spread * 0.15;
      del = rnd() * (D - per);
    }
    T.isx[i] = sx; T.isy[i] = sy; T.idel[i] = del;
  }
  return { dur: D, per };
}

/**
 * Mounts the effect on a canvas that fills `host`. The portrait image loads in the
 * background; until it is sampled the canvas stays clear and the hero shows as usual.
 * `mobileQuery` selects the mobile placement; with the desktop placement the figure keeps
 * clear of the ink of `clearOf` (the name's lines).
 */
export function mountHeroPixel(
  canvas: HTMLCanvasElement, host: HTMLElement, imageUrl: string, P: HeroPixelParams,
  opts: { mobileQuery: string; clearOf: Element[] },
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const mobile = window.matchMedia(opts.mobileQuery);
  const canRound = typeof ctx.roundRect === 'function';
  let src: Source | null = null;
  let T: Tiles | null = null;
  let W = 0, H = 0, dpr = 1, pxk = 1, wasMobile: boolean | null = null, lastClear: number | null = null;
  const intro = { active: false, start: 0, dur: 1.8, per: 1 };
  let pendingIntro = false;

  // Ink right edge of the widest `clearOf` line, in hero px (null: nothing to clear).
  const measureClear = () => {
    if (!opts.clearOf.length) return null;
    const left = host.getBoundingClientRect().left;
    let right = -Infinity;
    for (const el of opts.clearOf) {
      const r = document.createRange();
      r.selectNodeContents(el);
      right = Math.max(right, r.getBoundingClientRect().right - left);
    }
    return right;
  };

  // ---- sizing, sampling, colouring (only when the hero's size, placement or name width changes) ----
  const rebuild = () => {
    if (!src) return;
    const isMobile = mobile.matches;
    // A new placement replays the entrance, as switching viewports did in the tuner.
    if (wasMobile !== null && isMobile !== wasMobile) pendingIntro = true;
    wasMobile = isMobile;
    lastClear = isMobile ? null : measureClear();
    T = placeTiles(src, P, isMobile ? P.placement.mobile : P.placement.desktop, W, H, lastClear).tiles;
    if (T && intro.active) Object.assign(intro, initIntro(T, P, H));
  };
  const resize = () => {
    dpr = Math.min(window.devicePixelRatio || 1, P.render.dprMax);
    W = host.clientWidth;
    H = host.clientHeight;
    canvas.width = Math.max(1, Math.round(W * dpr));
    canvas.height = Math.max(1, Math.round(H * dpr));
    pxk = canvas.width / Math.max(1, W);
    rebuild();
  };

  // ---- pointer: samples along the stroke push tiles for trailMs ----
  type Sample = { x: number; y: number; t: number; dx: number; dy: number; len: number; speed: number; done: boolean };
  const ptr = { x: 0, y: 0, inside: false, has: false, lx: 0, ly: 0, speed: 0 };
  const samples: Sample[] = [];
  const pointerPos = (e: PointerEvent) => {
    const r = host.getBoundingClientRect();
    ptr.x = e.clientX - r.left;
    ptr.y = e.clientY - r.top;
  };
  const samplePointer = (now: number, dt: number) => {
    if (!ptr.inside) return;
    if (!ptr.has) { ptr.has = true; ptr.lx = ptr.x; ptr.ly = ptr.y; ptr.speed = 0; return; }
    const dx = ptr.x - ptr.lx, dy = ptr.y - ptr.ly, len = Math.hypot(dx, dy);
    if (len < 0.5) { ptr.speed *= 0.8; return; }
    ptr.speed = ptr.speed * 0.4 + (len / Math.max(dt, 1 / 240)) * 0.6;
    samples.push({ x: ptr.x, y: ptr.y, t: now, dx: dx / len, dy: dy / len, len, speed: ptr.speed, done: false });
    if (samples.length > 96) samples.shift();
    ptr.lx = ptr.x; ptr.ly = ptr.y;
  };
  const kick = (px: number, py: number, R: number, amt: number, mdx: number, mdy: number, mix: number) => {
    if (!T || amt <= 0 || R <= 0) return;
    const Lk = T.lookup, pitch = T.pitch, R2 = R * R;
    const ia = Math.max(0, Math.floor((px - R) / pitch) - Lk.i0), ib = Math.min(Lk.cols - 1, Math.floor((px + R) / pitch) - Lk.i0);
    const ja = Math.max(0, Math.floor((py - R) / pitch) - Lk.j0), jb = Math.min(Lk.rows - 1, Math.floor((py + R) / pitch) - Lk.j0);
    const hold = P.interaction.returnDelayMs / 1000;
    for (let j = ja; j <= jb; j++) for (let i = ia; i <= ib; i++) {
      const t = Lk.idx[j * Lk.cols + i];
      if (t < 0 || !T.visible[t]) continue;
      const dx = T.hx[t] + T.ox[t] - px, dy = T.hy[t] + T.oy[t] - py, d2 = dx * dx + dy * dy;
      if (d2 >= R2) continue;
      const d = Math.sqrt(d2);
      let ux = 0, uy = 1;
      if (d > 1e-3) { ux = dx / d; uy = dy / d; }
      if (mix > 0) {
        ux = ux * (1 - mix) + mdx * mix; uy = uy * (1 - mix) + mdy * mix;
        const l = Math.hypot(ux, uy) || 1; ux /= l; uy /= l;
      }
      const f = 1 - d / R, s = amt * f * f * (0.75 + 0.5 * hash3(T.ci[t], T.cj[t], 31));
      T.vx[t] += ux * s; T.vy[t] += uy * s;
      // Staggered hold (0.6x..1.4x) so the shape re-forms unevenly.
      if (f > 0.05) T.hold[t] = Math.max(T.hold[t], hold * (0.6 + 0.8 * hash3(T.ci[t], T.cj[t], 47)));
      T.act[t] = 1;
    }
  };
  const applyTrail = (now: number, dt: number) => {
    const I = P.interaction, R = I.scatterRadiusPx, trail = I.trailMs;
    for (let s = samples.length - 1; s >= 0; s--) {
      const sm = samples[s], age = now - sm.t;
      let w: number;
      if (trail < 34) { if (sm.done) { samples.splice(s, 1); continue; } w = 1; sm.done = true; }
      else { if (age > trail) { samples.splice(s, 1); continue; } w = (1 - age / trail) * (dt * 1000) / (trail / 2); }
      const speedF = I.followPointerVelocity ? clamp(sm.speed / 700, 0.35, 3) : 1;
      const amt = I.impulsePxPerS * Math.min(1, sm.len / R) * 1.5 * speedF * w;
      kick(sm.x, sm.y, R, amt, sm.dx, sm.dy, I.followPointerVelocity ? I.velocityDirectionMix : 0);
    }
  };
  const pulseAt = (x: number, y: number) => {
    const I = P.interaction;
    kick(x, y, I.autoPulseRadiusPx, I.impulsePxPerS * 1.2, 0, 1, 0);
  };
  let nextPulse = 0;
  const autoPulseTick = (now: number) => {
    const I = P.interaction;
    if (!I.autoPulse || !T || !T.drawN) return;
    if (!nextPulse) nextPulse = now + I.autoPulseIntervalS * 1000;
    if (now >= nextPulse) {
      nextPulse = now + I.autoPulseIntervalS * 1000;
      const i = T.order[Math.floor(Math.random() * T.drawN)];
      pulseAt(T.hx[i], T.hy[i]);
    }
  };
  const stepPhysics = (dt: number) => {
    if (!T) return;
    const I = P.interaction;
    const damp = Math.exp(-I.dampingPerS * dt);
    const ang = I.driftAngleDeg * Math.PI / 180;
    const gx = Math.cos(ang) * I.gravityPxPerS2, gy = Math.sin(ang) * I.gravityPxPerS2;
    const k = I.springStiffness;
    const { ox, oy, vx, vy, hold, act } = T;
    let active = 0;
    for (let i = 0; i < T.n; i++) {
      if (!act[i]) continue;
      if (hold[i] > 0) { hold[i] -= dt; vx[i] += gx * dt; vy[i] += gy * dt; }
      else { vx[i] -= k * ox[i] * dt; vy[i] -= k * oy[i] * dt; }
      vx[i] *= damp; vy[i] *= damp;
      ox[i] += vx[i] * dt; oy[i] += vy[i] * dt;
      if (hold[i] <= 0 && Math.abs(ox[i]) < 0.15 && Math.abs(oy[i]) < 0.15 && Math.abs(vx[i]) < 3 && Math.abs(vy[i]) < 3) {
        ox[i] = oy[i] = vx[i] = vy[i] = hold[i] = 0; act[i] = 0;
      } else active++;
    }
    T.activeN = active;
  };

  // ---- drawing; `still` = the assembled figure with no motion (reduced motion) ----
  const draw = (now: number, still: boolean) => {
    ctx.setTransform(pxk, 0, 0, pxk, 0, 0);
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, W, H);
    if (!T || !T.drawN) return;
    const k = pxk, sz = Math.max(1, Math.round(T.tile * k)) / k, half = T.tile / 2;
    const shape = P.grid.shape, path = shape !== 'square' && canRound;
    const rad = shape === 'circle' ? sz / 2 : sz * P.grid.cornerRadiusPct / 100;
    const id = P.idle, tsec = now / 1000;
    const windOn = !still && id.wind.enabled && id.wind.amplitudePx > 0;
    const wAmp = id.wind.amplitudePx, wBias = id.wind.capeBias, wT = tsec * id.wind.speed * 2.2;
    const breath = windOn ? Math.sin(tsec * id.wind.speed * 1.3) * wAmp * 0.5 : 0;
    let introOn = !still && intro.active, iel = 0;
    const per = intro.per;
    if (introOn) { iel = (now - intro.start) / 1000; if (iel > intro.dur) { intro.active = false; introOn = false; } }
    const { order, hx, hy, ox, oy, cape, phase, ny, isx, isy, idel, colorId, alphaQ, palette, px, py } = T;
    let curC = -1, curA = -1, open = false;
    for (let o = 0; o < T.drawN; o++) {
      const i = order[o];
      let x = hx[i] + ox[i], y = hy[i] + oy[i];
      if (windOn) {
        const w = wAmp * ((1 - wBias) + wBias * cape[i]), ph = wT + phase[i];
        x += w * Math.sin(ph);
        y += w * 0.45 * Math.sin(ph * 1.37 + 1.3) + breath * (1 - ny[i]);
      }
      if (introOn) {
        const p = (iel - idel[i]) / per;
        if (p < 1) { const e = p <= 0 ? 0 : 1 - (1 - p) * (1 - p) * (1 - p); x += isx[i] * (1 - e); y += isy[i] * (1 - e); }
      }
      const cid = colorId[i], a = alphaQ[i];
      if (cid !== curC || a !== curA) {
        if (open) { ctx.fill(); open = false; }
        if (a !== curA) { ctx.globalAlpha = a; curA = a; }
        if (cid !== curC) { ctx.fillStyle = palette[cid]; curC = cid; }
      }
      const rx = Math.round((x - half) * k) / k, ry = Math.round((y - half) * k) / k;
      px[i] = rx; py[i] = ry;
      if (!path) ctx.fillRect(rx, ry, sz, sz);
      else {
        if (!open) { ctx.beginPath(); open = true; }
        if (shape === 'circle') { ctx.moveTo(rx + sz, ry + rad); ctx.arc(rx + rad, ry + rad, rad, 0, TAU); }
        else ctx.roundRect(rx, ry, sz, sz, rad);
      }
    }
    if (open) ctx.fill();
    // Twinkle: a brief brightness lift on a hashed subset of tiles.
    const tw = id.twinkle;
    if (!still && tw.enabled && tw.ratioPct > 0 && tw.strength > 0) {
      const ratio = tw.ratioPct / 100, f = tw.frequencyHz;
      ctx.fillStyle = '#ffffff';
      for (let o = 0; o < T.drawN; o++) {
        const i = order[o], ph = tsec * f + T.tph[i], q = Math.floor(ph);
        if (hash3(T.ci[i], T.cj[i], q) >= ratio) continue;
        ctx.globalAlpha = tw.strength * Math.sin(Math.PI * (ph - q)) * alphaQ[i];
        if (!path) ctx.fillRect(px[i], py[i], sz, sz);
        else {
          ctx.beginPath();
          if (shape === 'circle') ctx.arc(px[i] + rad, py[i] + rad, rad, 0, TAU); else ctx.roundRect(px[i], py[i], sz, sz, rad);
          ctx.fill();
        }
      }
    }
    ctx.globalAlpha = 1;
  };

  // ---- frame loop: runs only while the hero is on screen and the tab is visible ----
  let raf = 0, lastT = 0, visible = true;
  const loop = (t: number) => {
    raf = 0;
    const dt = lastT ? Math.min(0.05, (t - lastT) / 1000) : 1 / 60;
    lastT = t;
    if (T) {
      // The entrance starts on the first frame the hero is actually seen.
      if (pendingIntro) {
        pendingIntro = false;
        if (P.idle.intro.enabled) Object.assign(intro, initIntro(T, P, H), { active: true, start: t });
      }
      samplePointer(t, dt); applyTrail(t, dt); autoPulseTick(t); stepPhysics(dt);
    }
    draw(t, false);
    if (visible && !document.hidden) raf = requestAnimationFrame(loop);
  };
  const start = () => {
    if (!raf && !reduce && src && visible && !document.hidden) { lastT = 0; raf = requestAnimationFrame(loop); }
  };
  const refresh = () => { resize(); if (reduce) draw(0, true); };

  new ResizeObserver(refresh).observe(host);
  // Web fonts change the name's width without resizing the hero: resample (no entrance replay).
  const onFonts = () => {
    if (!src || mobile.matches || measureClear() === lastClear) return;
    rebuild();
    if (reduce) draw(0, true);
  };
  document.fonts.ready.then(onFonts);
  document.fonts.addEventListener('loadingdone', onFonts);
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) start(); }).observe(host);
  document.addEventListener('visibilitychange', start);
  if (!reduce) {
    host.addEventListener('pointermove', (e) => { pointerPos(e); ptr.inside = true; });
    host.addEventListener('pointerdown', (e) => {
      pointerPos(e); ptr.inside = true; ptr.has = false;
      // No preventDefault and no touch-action change: the page keeps scrolling.
      if (e.pointerType !== 'mouse') pulseAt(ptr.x, ptr.y);
    });
    const pointerOut = () => { ptr.inside = false; ptr.has = false; };
    host.addEventListener('pointerleave', pointerOut);
    host.addEventListener('pointercancel', pointerOut);
    host.addEventListener('pointerup', (e) => { if (e.pointerType !== 'mouse') pointerOut(); });
  }

  // ---- portrait: decoded off the critical path, read once into summed-area tables ----
  const img = new Image();
  img.decoding = 'async';
  img.onload = () => {
    const sw = P.source.sampleWidthPx, sh = P.source.sampleHeightPx;
    const c = document.createElement('canvas');
    c.width = sw; c.height = sh;
    const x = c.getContext('2d', { willReadFrequently: true });
    if (!x) return;
    x.drawImage(img, 0, 0, sw, sh);
    try { src = buildSource(x.getImageData(0, 0, sw, sh).data, sw, sh); } catch { return; }
    pendingIntro = true;
    refresh();
    start();
  };
  img.src = imageUrl;
}
