// Language-routing gate: the country lookup picks zh/en, a saved choice always wins,
// crawlers and single-language pages are never redirected, every outcome clears
// html[data-lang-pending] (the page is never left hidden), and each decision reaches
// analytics exactly once (the lang-route handoff is consumed, never left behind).
// Usage: npx astro preview --port 4321   (in another terminal)
//        node scripts/check-lang-detect.mjs   (BASE_URL / CHROME_PATH env vars override defaults)
//
// The three providers in src/data/lang.yaml are answered (or failed, or hung) by request
// interception, so the check is deterministic and needs no network. Each scenario runs in
// a fresh browser context — a fresh visitor with empty storage.
import puppeteer from 'puppeteer-core';

const BASE = process.env.BASE_URL || 'http://localhost:4321';
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PROVIDER_HOSTS = ['www.cloudflare.com', 'ipwho.is', 'get.geojs.io'];
const BOT_UA = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One provider's real answer shape for a country. */
function providerAnswer(host, country) {
  if (host === 'www.cloudflare.com') {
    return { type: 'text/plain', body: `fl=test\nh=www.cloudflare.com\nip=198.51.100.7\nloc=${country}\ncolo=SYD\n` };
  }
  if (host === 'ipwho.is') {
    return { type: 'application/json', body: JSON.stringify({ ip: '198.51.100.7', success: true, country_code: country }) };
  }
  return { type: 'application/json', body: JSON.stringify({ ip: '198.51.100.7', country_code: country }) };
}

// Scenario fields: path/country/langs/ua/storage/gtagStub/mock (country, fail, hang, delayMs)
// and per-step expectations: expectPath, expectPref, expectHop, expectCalls, expectCallsAtLeast,
// expectRoute. `steps` runs several loads in one tab; `expectHop: '1'` means a jump happened,
// null means not. `gtagStub` records what the page would send to gtag (GA is absent locally).
const scenarios = [
  {
    name: 'no choice, AU visitor: / redirects to /en/',
    path: '/', country: 'AU', expectPath: '/en/', expectPref: 'en', expectHop: '1', expectCalls: 1,
  },
  {
    name: 'no choice, CN visitor: stays on zh',
    path: '/', country: 'CN', expectPath: '/', expectPref: 'zh', expectHop: null, expectCalls: 1,
  },
  {
    name: 'country beats the browser language (AU + zh browser): /en/',
    path: '/', country: 'AU', langs: ['zh-CN', 'zh'], expectPath: '/en/', expectPref: 'en', expectCalls: 1,
  },
  {
    name: 'CN visitor on an /en/ deep link: /en/portfolio/ → /portfolio/',
    path: '/en/portfolio/', country: 'CN', expectPath: '/portfolio/', expectPref: 'zh', expectHop: '1', expectCalls: 1,
  },
  {
    name: 'lookup held open: hidden meanwhile, then zh shown',
    path: '/', country: 'CN', delayMs: 600, expectHiddenWhileWaiting: true,
    expectPath: '/', expectPref: 'zh', expectCalls: 1,
  },
  {
    name: 'providers all fail + zh browser: stays zh',
    path: '/', country: null, langs: ['zh-CN'], expectPath: '/', expectPref: 'zh', expectCalls: 3,
  },
  {
    name: 'providers all fail + en browser: / → /en/',
    path: '/', country: null, langs: ['en-US'], expectPath: '/en/', expectPref: 'en', expectCalls: 3,
  },
  {
    name: 'first provider fails, second says CN: stays zh',
    path: '/', country: 'CN', fail: ['www.cloudflare.com'], expectPath: '/', expectPref: 'zh', expectCalls: 2,
  },
  {
    name: 'providers hang: deadline decides from an en browser → /en/',
    path: '/', hang: PROVIDER_HOSTS, langs: ['en-US'], expectPath: '/en/', expectPref: 'en', expectCallsAtLeast: 1,
  },
  {
    name: 'saved zh, AU visitor: /resume/ stays, no lookup',
    path: '/resume/', country: 'AU', storage: { lang: 'zh' }, expectPath: '/resume/', expectPref: 'zh', expectCalls: 0,
  },
  {
    name: 'saved zh, en deep link: /en/resume/ → /resume/',
    path: '/en/resume/', country: 'AU', storage: { lang: 'zh' }, expectPath: '/resume/', expectPref: 'zh', expectHop: '1', expectCalls: 0,
  },
  {
    name: 'saved en, CN visitor: / → /en/',
    path: '/', country: 'CN', storage: { lang: 'en' }, expectPath: '/en/', expectPref: 'en', expectCalls: 0,
  },
  {
    name: 'one automatic jump per tab: the second zh URL stays',
    storage: { lang: 'en' }, country: 'AU',
    steps: [
      { path: '/', expectPath: '/en/', expectCalls: 0 },
      { path: '/resume/', expectPath: '/resume/', expectCalls: 0 },
    ],
  },
  {
    name: 'crawler UA: no redirect, no lookup, no hiding',
    path: '/', country: 'US', ua: BOT_UA, expectPath: '/', expectPref: null, expectCalls: 0,
  },
  {
    name: 'blog post is single-language: never redirected',
    path: '/blog/ai-bazi-experiment/', country: 'US', expectPath: '/blog/ai-bazi-experiment/', expectCalls: 0,
  },
  {
    name: '404 page: never redirected',
    path: '/404.html', country: 'US', expectPath: '/404.html', expectCalls: 0,
  },
  {
    name: 'header switcher stores the choice and stops the routing',
    country: 'CN',
    steps: [
      { path: '/', expectPath: '/', expectPref: 'zh', expectCalls: 1 },
      { click: 'a[data-set-lang="en"]', expectPath: '/en/', expectPref: 'en', expectCalls: 0 },
      { path: '/', expectPath: '/en/', expectPref: 'en', expectCalls: 0 },
    ],
  },
  {
    name: 'lang_route reported once: redirect case',
    path: '/', country: 'AU', gtagStub: true, expectPath: '/en/',
    expectRoute: { from_language: 'zh', to_language: 'en', source: 'ip', redirected: 1 },
  },
  {
    name: 'lang_route reported once: stay case',
    path: '/', country: 'CN', gtagStub: true, expectPath: '/',
    expectRoute: { from_language: 'zh', to_language: 'zh', source: 'ip', redirected: 0 },
  },
];

async function waitForPath(page, expected, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let pathname = null;
    try { pathname = new URL(page.url()).pathname; } catch { /* mid-navigation */ }
    if (pathname === expected) return true;
    await sleep(50);
  }
  return false;
}

/** True once the page is settled and painted: no pending flag, body visible, text present. */
async function waitForVisible(page, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const ok = await page.evaluate(() => {
        if (document.documentElement.hasAttribute('data-lang-pending')) return false;
        if (getComputedStyle(document.body).visibility === 'hidden') return false;
        return (document.body.innerText || '').trim().length > 0;
      });
      if (ok) return true;
    } catch { /* a navigation is swapping the document */ }
    await sleep(50);
  }
  return false;
}

/** Reads { path, pref, hop, record, routes } from the current document. */
async function readState(page) {
  return page.evaluate(() => ({
    path: location.pathname,
    pref: (() => { try { return localStorage.getItem('lang'); } catch { return null; } })(),
    hop: (() => { try { return sessionStorage.getItem('lang-hop'); } catch { return null; } })(),
    record: (() => { try { return sessionStorage.getItem('lang-route'); } catch { return 'unavailable'; } })(),
    routes: (window.dataLayer || []).filter((a) => a && a[0] === 'event' && a[1] === 'lang_route').map((a) => a[2]),
  })).catch(() => null);
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--hide-scrollbars'] });
let failures = 0;
let currentMock = {}; // read by the interception handler below

try {
  for (const scenario of scenarios) {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    // Without this the mocked answers are ignored and the real providers are called.
    await page.setRequestInterception(true);
    let calls = 0;

    page.on('request', (req) => {
      let host = '';
      try { host = new URL(req.url()).host; } catch { /* file: and friends */ }
      if (!PROVIDER_HOSTS.includes(host)) { req.continue().catch(() => {}); return; }
      calls += 1;
      if ((currentMock.hang || []).includes(host)) return; // never answered: the deadline path
      if ((currentMock.fail || []).includes(host) || !currentMock.country) { req.abort('failed').catch(() => {}); return; }
      const answer = providerAnswer(host, currentMock.country);
      const send = () => req.respond({
        status: 200,
        contentType: answer.type,
        headers: { 'access-control-allow-origin': '*', 'cache-control': 'no-store' },
        body: answer.body,
      }).catch(() => {});
      if (currentMock.delayMs) setTimeout(send, currentMock.delayMs);
      else send();
    });

    if (scenario.ua) await page.setUserAgent({ userAgent: scenario.ua });
    await page.evaluateOnNewDocument((seed) => {
      try {
        Object.defineProperty(navigator, 'languages', { get: () => seed.langs });
        Object.defineProperty(navigator, 'language', { get: () => seed.langs[0] });
      } catch { /* keep the real values */ }
      for (const key of Object.keys(seed.storage)) {
        try { localStorage.setItem(key, seed.storage[key]); } catch { /* storage unavailable */ }
      }
    }, { langs: scenario.langs || ['en-AU', 'en'], storage: scenario.storage || {} });

    if (scenario.gtagStub) {
      await page.evaluateOnNewDocument(() => {
        window.dataLayer = window.dataLayer || [];
        window.gtag = function () { window.dataLayer.push(Array.from(arguments)); };
      });
    }

    const steps = scenario.steps || [scenario];
    for (let index = 0; index < steps.length; index++) {
      const step = steps[index];
      const label = scenario.name + (steps.length > 1 ? ` [step ${index + 1}]` : '');
      const reasons = [];

      currentMock = {
        country: 'country' in step ? step.country : scenario.country,
        fail: step.fail || scenario.fail || [],
        hang: step.hang || scenario.hang || [],
        delayMs: step.delayMs || scenario.delayMs || 0,
      };
      calls = 0;

      if (step.click) {
        await page.click(step.click).catch(() => {});
      } else {
        await page.goto(BASE + step.path, { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
      }

      if (step.expectHiddenWhileWaiting) {
        await sleep(120);
        const mid = await page.evaluate(() => ({
          pending: document.documentElement.hasAttribute('data-lang-pending'),
          visibility: getComputedStyle(document.body).visibility,
        })).catch(() => null);
        if (!mid || !mid.pending || mid.visibility !== 'hidden') {
          reasons.push(`not hidden while the lookup was open: ${JSON.stringify(mid)}`);
        }
      }

      const expectPath = step.expectPath;
      if (expectPath && expectPath !== step.path) {
        if (!(await waitForPath(page, expectPath))) reasons.push(`expected ${expectPath}, still at ${page.url()}`);
      } else if (expectPath) {
        // Staying put: give any late routing decision time to fire, then confirm the path held.
        await sleep(900);
        let pathname = null;
        try { pathname = new URL(page.url()).pathname; } catch { /* ignore */ }
        if (pathname !== expectPath) reasons.push(`expected to stay on ${expectPath}, got ${pathname}`);
      }

      if (!(await waitForVisible(page))) reasons.push('page never became visible (data-lang-pending stuck?)');

      // The decision must be handed to analytics exactly once: reportLangRoute() reads and
      // clears the sessionStorage record (on module load, or on the lang-route event).
      let state = await readState(page);
      const settleDeadline = Date.now() + 2500;
      while (state && state.record !== null && Date.now() < settleDeadline) {
        await sleep(50);
        state = await readState(page);
      }

      if ('expectPref' in step && (!state || state.pref !== step.expectPref)) {
        reasons.push(`pref=${state && state.pref} (want ${step.expectPref})`);
      }
      if ('expectHop' in step && (!state || state.hop !== step.expectHop)) {
        reasons.push(`lang-hop=${state && state.hop} (want ${step.expectHop})`);
      }
      if ('expectCalls' in step && calls !== step.expectCalls) {
        reasons.push(`provider calls=${calls} (want ${step.expectCalls})`);
      }
      if ('expectCallsAtLeast' in step && calls < step.expectCallsAtLeast) {
        reasons.push(`provider calls=${calls} (want at least ${step.expectCallsAtLeast})`);
      }
      if (!state || state.record !== null) {
        reasons.push(`lang-route record was never consumed: ${state && state.record}`);
      }
      if ('expectRoute' in step) {
        const sent = (state && state.routes) || [];
        if (sent.length !== 1 || JSON.stringify(sent[0]) !== JSON.stringify(step.expectRoute)) {
          reasons.push(`lang_route events=${JSON.stringify(sent)} (want exactly ${JSON.stringify(step.expectRoute)})`);
        }
      }

      const ok = reasons.length === 0;
      if (!ok) failures += 1;
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
      console.log(`      path=${state && state.path}  pref=${state && state.pref}  hop=${state && state.hop}  providerCalls=${calls}`);
      for (const reason of reasons) console.log(`      → ${reason}`);
    }

    await context.close();
  }
} finally {
  await browser.close();
}

console.log(failures === 0 ? '\nAll language-routing checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
