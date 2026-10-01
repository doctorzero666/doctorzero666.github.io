// Layout gate: no horizontal overflow on any page, and the hero name is visible.
// Note: a headless Chrome window cannot be narrower than 500px, so a screenshot taken
// with --window-size=390 is a 500px layout cropped to 390px. This script sets a real
// 390px viewport through DevTools instead.
// Usage: npx astro preview --port 4321   (in another terminal)
//        node scripts/check-layout.mjs   (BASE_URL / CHROME_PATH env vars override defaults)
import puppeteer from 'puppeteer-core';

const BASE = process.env.BASE_URL || 'http://localhost:4321';
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PAGES = ['/', '/resume/', '/portfolio/', '/blog/', '/now/', '/en/', '/en/resume/', '/en/portfolio/', '/en/blog/', '/en/now/', '/404.html'];
const VIEWPORTS = [
  { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  { width: 1280, height: 800 },
];

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--hide-scrollbars'] });
let failed = false;
try {
  for (const vp of VIEWPORTS) {
    const page = await browser.newPage();
    await page.setViewport(vp);
    for (const path of PAGES) {
      await page.goto(BASE + path, { waitUntil: 'networkidle0' });
      const isHome = path === '/' || path === '/en/';
      if (isHome) await new Promise((r) => setTimeout(r, 1500));
      const m = await page.evaluate(() => {
        const name = document.querySelector('#hero-name .last');
        const first = document.querySelector('#hero-name .first');
        // Content can poke out past the viewport even when body { overflow-x: clip }
        // hides it from scrollWidth, so also count elements whose box crosses the right
        // edge, skipping those inside a deliberately clipped container (e.g. the hero).
        const clipped = (el) => {
          for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
            const ox = getComputedStyle(a).overflowX;
            if (ox === 'hidden' || ox === 'clip') return true;
          }
          return false;
        };
        const poking = [...document.querySelectorAll('body *')]
          .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 0.5 && !clipped(el))
          .map((el) => el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : ''));
        // Ink width of the name's text, not the width of its block box.
        const inkWidth = (el) => {
          const r = document.createRange();
          r.selectNodeContents(el);
          return r.getBoundingClientRect().width;
        };
        return {
          poking: poking.slice(0, 5),
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth,
          name: name && first
            ? {
                opacity: Math.min(Number(getComputedStyle(first).opacity), Number(getComputedStyle(name).opacity)),
                width: Math.round(Math.max(inkWidth(first), inkWidth(name))),
              }
            : null,
        };
      });
      const over = m.scrollWidth > m.innerWidth || m.poking.length > 0;
      if (over) failed = true;
      console.log(`${String(vp.width).padStart(4)}  ${path.padEnd(16)} scrollWidth=${m.scrollWidth} innerWidth=${m.innerWidth}${over ? '  OVERFLOW ' + m.poking.join(', ') : ''}`);
      if (isHome && path === '/') {
        const bad = !m.name || m.name.opacity < 1 || m.name.width === 0;
        if (bad) failed = true;
        console.log(`      hero name opacity=${m.name?.opacity} width=${m.name?.width}${bad ? '  INVISIBLE' : ''}`);
      }
    }
    await page.close();
  }
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
