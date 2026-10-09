// Offline background removal for the home hero's pixel portrait.
//
// Same mask as the pixel tuner (~/claude-tmp/personal-site/pixel-tuner): flood fill from the
// four edges over near-white pixels, then large enclosed paper-white holes, then one pass over
// the light anti-aliased fringe. Thresholds come from mask.* in src/data/hero-pixel.json.
// Output: a WebP whose alpha is the mask (0 = background, 255 = figure). The runtime
// (src/lib/hero-pixel.ts) only samples tile coverage and mean colour from it.
//
// The source image is not in the repository; pass its path. Decoding and WebP encoding run
// in the local Chrome (puppeteer-core, as check-layout.mjs does), so the pixels are the ones
// the tuner read in the browser. Re-running with the same inputs and Chrome writes the same
// file (the sha256 is printed).
// Usage: node scripts/build-hero-portrait.mjs <source image> [output .webp]
//        (or HERO_SOURCE=<source image>); output defaults to src/assets/hero/portrait.webp.
//        CHROME_PATH overrides Chrome.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = new URL('..', import.meta.url);
const params = JSON.parse(readFileSync(new URL('src/data/hero-pixel.json', root), 'utf8'));
const IN = process.argv[2] || process.env.HERO_SOURCE;
if (!IN) {
  console.error('Missing source image. Usage: node scripts/build-hero-portrait.mjs <source image> [output .webp]');
  console.error('The source is kept outside the repository (local copy: ~/claude-tmp/personal-site/pixel-tuner/source.jpg).');
  process.exit(1);
}
if (!existsSync(IN)) {
  console.error(`Source image not found: ${IN}`);
  process.exit(1);
}
const OUT = process.argv[3] || fileURLToPath(new URL('src/assets/hero/portrait.webp', root));
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
// Lossy colour, exact alpha (the encoder keeps alpha lossless; checked below). Each tile
// averages dozens of source pixels, so against a lossless file the tile set is identical and
// roughly one tile in eight lands one or two steps away in the runtime's 6-bit palette
// (measured at 390-1920px wide). Quality 1 is lossless and bit-exact, at about 535 KB instead of 94 KB.
const WEBP_QUALITY = 0.95;
const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

// ---- mask: port of the tuner's buildMask() ----
function buildMask(d, w, h, m) {
  const n = w * h;
  const tol = m.whiteTolerance;
  const near = new Uint8Array(n);
  const deficit = new Uint8Array(n); // 255 - min(r,g,b): distance from paper white
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    if (d[i + 3] < 128) { near[p] = 2; deficit[p] = 0; continue; }
    const v = Math.min(d[i], d[i + 1], d[i + 2]);
    deficit[p] = 255 - v;
    near[p] = 255 - v <= tol ? 1 : 0;
  }
  const bg = new Uint8Array(n);
  const stack = new Int32Array(n);
  let sp = 0;
  const seed = (p) => { if (near[p] && !bg[p]) { bg[p] = 1; stack[sp++] = p; } };
  for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  for (const [sx, sy] of m.extraSeeds) seed(clamp(Math.floor(sy * h), 0, h - 1) * w + clamp(Math.floor(sx * w), 0, w - 1));
  while (sp) {
    const p = stack[--sp], x = p % w;
    if (x > 0) seed(p - 1);
    if (x < w - 1) seed(p + 1);
    if (p >= w) seed(p - w);
    if (p < n - w) seed(p + w);
  }
  for (let p = 0; p < n; p++) if (near[p] === 2) bg[p] = 1;
  // Enclosed near-white regions go only if large (>= holeMinAreaPct of the image) AND almost
  // pure paper white (mean deficit <= 12); shaded whites such as the cravat survive.
  const holes = [];
  if (m.holeMinAreaPct > 0) {
    const minArea = n * m.holeMinAreaPct / 100;
    const seen = new Uint8Array(n);
    for (let p0 = 0; p0 < n; p0++) {
      if (near[p0] !== 1 || bg[p0] || seen[p0]) continue;
      let top = 0, area = 0, defSum = 0;
      stack[top++] = p0; seen[p0] = 1;
      const members = [];
      while (top) {
        const p = stack[--top], x = p % w;
        members.push(p); area++; defSum += deficit[p];
        if (x > 0 && near[p - 1] === 1 && !bg[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack[top++] = p - 1; }
        if (x < w - 1 && near[p + 1] === 1 && !bg[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack[top++] = p + 1; }
        if (p >= w && near[p - w] === 1 && !bg[p - w] && !seen[p - w]) { seen[p - w] = 1; stack[top++] = p - w; }
        if (p < n - w && near[p + w] === 1 && !bg[p + w] && !seen[p + w]) { seen[p + w] = 1; stack[top++] = p + w; }
      }
      const removed = area >= minArea && defSum / area <= 12;
      if (area >= 150) holes.push({ areaPct: +(100 * area / n).toFixed(3), meanDeficit: +(defSum / area).toFixed(1), removed });
      if (removed) for (const p of members) bg[p] = 1;
    }
  }
  if (m.fringeCleanup) {
    // One pass: light anti-aliased pixels touching the removed background go too.
    const loose = Math.min(255, tol * 2 + 20);
    const kill = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (bg[p] || deficit[p] > loose) continue;
      if ((x > 0 && bg[p - 1]) || (x < w - 1 && bg[p + 1]) || (y > 0 && bg[p - w]) || (y < h - 1 && bg[p + w])) kill.push(p);
    }
    for (const p of kill) bg[p] = 1;
  }
  return { bg, holes };
}

const mime = MIME[extname(IN).toLowerCase()];
if (!mime) throw new Error(`Unsupported source type: ${IN}`);
const srcUrl = `data:${mime};base64,${readFileSync(IN).toString('base64')}`;

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
try {
  const page = await browser.newPage();
  // Base64 helpers live in the page; Node only sees strings.
  await page.evaluate(() => {
    window.toB64 = (bytes) => new Promise((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result).split(',')[1]);
      fr.readAsDataURL(new Blob([bytes]));
    });
    window.readPixels = async (url, w, h) => {
      const img = new Image();
      img.src = url;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = w || img.naturalWidth; c.height = h || img.naturalHeight;
      const x = c.getContext('2d', { willReadFrequently: true });
      x.drawImage(img, 0, 0, c.width, c.height);
      return { img, data: x.getImageData(0, 0, c.width, c.height).data };
    };
  });

  // 1. Decode at the tuner's sampling size (long side <= 1000 px).
  const decoded = await page.evaluate(async (url) => {
    const probe = new Image();
    probe.src = url;
    await probe.decode();
    const w0 = probe.naturalWidth, h0 = probe.naturalHeight;
    const k = Math.min(1, 1000 / Math.max(w0, h0));
    const w = Math.max(1, Math.round(w0 * k)), h = Math.max(1, Math.round(h0 * k));
    const { data } = await window.readPixels(url, w, h);
    return { w, h, b64: await window.toB64(data) };
  }, srcUrl);
  const { w, h } = decoded;
  const want = params.source;
  if (w !== want.sampleWidthPx || h !== want.sampleHeightPx) {
    throw new Error(`Source samples at ${w}x${h}, but hero-pixel.json was tuned at ${want.sampleWidthPx}x${want.sampleHeightPx}.`);
  }
  const px = Buffer.from(decoded.b64, 'base64');

  // 2. Mask, then figure pixels keep their colour and background becomes transparent black.
  const { bg, holes } = buildMask(px, w, h, params.mask);
  const rgba = Buffer.alloc(w * h * 4);
  let removed = 0;
  for (let p = 0; p < w * h; p++) {
    if (bg[p]) { removed++; continue; }
    px.copy(rgba, p * 4, p * 4, p * 4 + 3);
    rgba[p * 4 + 3] = 255;
  }

  // 3. Encode, then decode the result and check the alpha survived exactly.
  const enc = await page.evaluate(async (b64, w, h, q) => {
    const bytes = Uint8ClampedArray.from(atob(b64), (ch) => ch.charCodeAt(0));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').putImageData(new ImageData(bytes, w, h), 0, 0);
    const url = c.toDataURL('image/webp', q);
    if (!url.startsWith('data:image/webp')) throw new Error('This Chrome cannot encode WebP');
    const back = (await window.readPixels(url)).data;
    let alphaDiff = 0, rgbErr = 0, rgbMax = 0, figure = 0;
    for (let i = 0; i < back.length; i += 4) {
      if (back[i + 3] !== bytes[i + 3]) alphaDiff++;
      if (bytes[i + 3] !== 255) continue;
      figure++;
      for (let k = 0; k < 3; k++) { const e = Math.abs(back[i + k] - bytes[i + k]); rgbErr += e; if (e > rgbMax) rgbMax = e; }
    }
    return { b64: url.split(',')[1], alphaDiff, rgbMeanErr: rgbErr / (figure * 3), rgbMax };
  }, rgba.toString('base64'), w, h, WEBP_QUALITY);
  if (enc.alphaDiff) throw new Error(`WebP changed ${enc.alphaDiff} alpha values`);

  const out = Buffer.from(enc.b64, 'base64');
  writeFileSync(OUT, out);
  console.log(`source   ${IN} (${w}x${h})`);
  console.log(`mask     removed ${(100 * removed / (w * h)).toFixed(2)}% of pixels; enclosed near-white regions: ${JSON.stringify(holes)}`);
  console.log(`output   ${OUT} ${out.length} bytes, webp quality ${WEBP_QUALITY}, alpha exact, rgb mean error ${enc.rgbMeanErr.toFixed(2)} (max ${enc.rgbMax})`);
  console.log(`sha256   ${createHash('sha256').update(out).digest('hex')}`);
} finally {
  await browser.close();
}
