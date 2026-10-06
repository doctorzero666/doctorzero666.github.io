/**
 * GA4 event tracking. This file is the only place that calls window.gtag (the base
 * snippet in src/layouts/Base.astro loads gtag.js and sends the default page_view).
 *
 * Attribute scheme (written at build time by src/lib/analytics-links.ts, read here):
 *   data-ga-event="<name> [<name> ...]"   one or more event names, space-separated
 *   data-ga-<param-name>="<value>"        one attribute per declared param; the attribute
 *                                         name is the GA param with "_" written as "-"
 *                                         (data-ga-project-id -> project_id)
 * Example:
 *   <a href="..." data-ga-event="project_source_click" data-ga-project-id="conclave"
 *      data-ga-project-name="Conclave" data-ga-destination="pypi">
 *
 * One element can carry several events (the footer LinkedIn link fires contact_click and
 * social_click). Each event only takes the params listed for it in EVENT_PARAMS, so shared
 * attributes never leak into the wrong event.
 *
 * Dynamic params are filled in at click time and are never read from attributes:
 *   page_path      location.pathname (no query string, no hash)
 *   site_language  <html lang>, normalised to 'zh' | 'en'
 *   from_language  same as site_language (the page being left); language_switch is skipped
 *                  when from_language === to_language
 *
 * Param names vs gtag.js fields (checked against real gtag.js, 2026-10-06): gtag treats
 * `language` as the hit's user-language field (ul) and `page_path` as the document path (dp),
 * so neither arrives as a custom event param. Hence `site_language`; `page_path` is sent
 * knowingly and lands in dp, which carries the real pathname, so it distorts nothing.
 * Do not add other gtag field names as params (language, page_location, page_title,
 * page_referrer, page_path, user_id, client_id...): they are not sent as event params.
 *
 * Guards: nothing is sent in dev builds, on the server, or when gtag is missing (no ID,
 * localhost, blocked by the browser). Values containing "@" or starting with "mailto:" are
 * dropped, and strings are cut to 100 characters (the GA4 limit).
 */

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

export const ANALYTICS_EVENTS = [
  'nav_click',
  'project_click',
  'project_source_click',
  'demo_click',
  'contact_click',
  'social_click',
  'language_switch',
  'transmission_click',
] as const;

export type AnalyticsEventName = (typeof ANALYTICS_EVENTS)[number];
export type AnalyticsParams = Record<string, string | number | undefined>;

/** The params each event may carry; anything else on the element is ignored. */
export const EVENT_PARAMS: Record<AnalyticsEventName, readonly string[]> = {
  nav_click: ['nav_item', 'site_language', 'page_path'],
  project_click: ['project_name', 'project_id', 'click_target'],
  project_source_click: ['project_name', 'project_id', 'destination'],
  demo_click: ['project_name', 'project_id'],
  contact_click: ['contact_type', 'page_path'],
  social_click: ['platform', 'page_path'],
  language_switch: ['from_language', 'to_language', 'page_path'],
  transmission_click: ['article_id', 'article_title'],
};

const MAX_VALUE_LENGTH = 100;
const EVENT_ATTR = 'data-ga-event';
const PARAM_ATTR_PREFIX = 'data-ga-';
const DYNAMIC_PARAMS = new Set(['page_path', 'site_language', 'from_language']);

export function isAnalyticsEvent(name: string): name is AnalyticsEventName {
  return (ANALYTICS_EVENTS as readonly string[]).includes(name);
}

/** Drops empty values and anything that looks like an email address; truncates strings. */
function sanitize(params: AnalyticsParams): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'number') {
      if (Number.isFinite(value)) out[key] = value;
      continue;
    }
    const s = String(value).trim();
    if (!s || s.includes('@') || /^mailto:/i.test(s)) continue;
    const chars = Array.from(s);
    out[key] = chars.length > MAX_VALUE_LENGTH ? chars.slice(0, MAX_VALUE_LENGTH).join('') : s;
  }
  return out;
}

export function trackEvent(name: AnalyticsEventName, params: AnalyticsParams): void {
  if (!import.meta.env.PROD) return;
  if (typeof window === 'undefined') return;
  if (typeof window.gtag !== 'function') return;
  if (!isAnalyticsEvent(name)) return;
  try {
    window.gtag('event', name, sanitize(params));
  } catch {
    /* analytics must never break the page */
  }
}

function currentLanguage(): 'zh' | 'en' {
  return /^en\b/i.test(document.documentElement.lang || '') ? 'en' : 'zh';
}

/** Declared params from data-ga-* attributes (data-ga-project-id -> project_id). */
function readParams(el: Element): Record<string, string> {
  const out: Record<string, string> = {};
  for (const attr of Array.from(el.attributes)) {
    if (attr.name === EVENT_ATTR || !attr.name.startsWith(PARAM_ATTR_PREFIX)) continue;
    out[attr.name.slice(PARAM_ATTR_PREFIX.length).replace(/-/g, '_')] = attr.value;
  }
  return out;
}

function onClick(event: MouseEvent): void {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const el = target.closest(`[${EVENT_ATTR}]`);
  if (!el) return;
  const names = (el.getAttribute(EVENT_ATTR) || '').split(/\s+/).filter(isAnalyticsEvent);
  if (names.length === 0) return;

  const declared = readParams(el);
  const language = currentLanguage();
  const dynamic: Record<string, string> = {
    page_path: window.location.pathname,
    site_language: language,
    from_language: language,
  };

  for (const name of names) {
    const params: AnalyticsParams = {};
    for (const key of EVENT_PARAMS[name]) {
      params[key] = DYNAMIC_PARAMS.has(key) ? dynamic[key] : declared[key];
    }
    if (name === 'language_switch' && params.from_language === params.to_language) continue;
    trackEvent(name, params);
  }
}

let installed = false;

/** Installs one delegated click listener on document. Safe to call more than once. */
export function initAnalytics(): void {
  if (installed || !import.meta.env.PROD || typeof document === 'undefined') return;
  installed = true;
  // Capture phase, so a handler that stops propagation further down cannot hide a click.
  document.addEventListener('click', onClick, true);
}
