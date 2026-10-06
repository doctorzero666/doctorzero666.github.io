// Build-time helpers that turn links into the data-ga-* attributes read by src/lib/analytics.ts.
// Imported from component frontmatter only, so none of this ships to the browser.
// Attribute scheme and the per-event param lists are documented at the top of analytics.ts.
import type { AnalyticsEventName } from './analytics';
import type { Project } from './data';

export type GaAttrs = Record<string, string>;

/** data-ga-event plus one data-ga-<param> attribute per non-empty param. */
export function gaAttrs(
  events: AnalyticsEventName | AnalyticsEventName[],
  params: Record<string, string | undefined> = {},
): GaAttrs {
  const attrs: GaAttrs = { 'data-ga-event': ([] as string[]).concat(events).join(' ') };
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') attrs[`data-ga-${key.replace(/_/g, '-')}`] = value;
  }
  return attrs;
}

/** Lowercase snake_case id from an English label ("Award announcement" -> "award_announcement"). */
export function snakeId(label: string): string {
  return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'link';
}

export type ProjectLinkClass =
  | { event: 'demo_click' }
  | { event: 'project_source_click'; destination: 'github' | 'pypi' }
  | { event: 'project_click'; click_target: string };

/**
 * Classifies a project link from its English label and URL, first match wins:
 * label contains "demo" -> demo_click; host github.com -> source (github);
 * host pypi.org -> source (pypi); anything else -> project_click with a label-derived target.
 */
export function classifyProjectLink(labelEn: string, url: string): ProjectLinkClass {
  if (/demo/i.test(labelEn)) return { event: 'demo_click' };
  let host = '';
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    /* relative or malformed URL: no host */
  }
  if (host === 'github.com') return { event: 'project_source_click', destination: 'github' };
  if (host === 'pypi.org') return { event: 'project_source_click', destination: 'pypi' };
  return { event: 'project_click', click_target: snakeId(labelEn) };
}

/** Attributes for one of a project's own links (repo, demo, package, announcement...). */
export function projectLinkAttrs(project: Project, link: Project['links'][number]): GaAttrs {
  const c = classifyProjectLink(link.label.en || link.label.zh, link.url);
  const base = { project_name: project.name, project_id: project.slug };
  if (c.event === 'project_source_click') return gaAttrs(c.event, { ...base, destination: c.destination });
  if (c.event === 'project_click') return gaAttrs(c.event, { ...base, click_target: c.click_target });
  return gaAttrs(c.event, base);
}

/** Attributes for a link that opens a project's entry on the site (click_target names the place). */
export function projectEntryAttrs(project: Project, clickTarget: string): GaAttrs {
  return gaAttrs('project_click', { project_name: project.name, project_id: project.slug, click_target: clickTarget });
}

/** Profile links that are also contact entries; they fire contact_click as well as social_click. */
const CONTACT_LINK_IDS = new Set(['linkedin']);

/** Attributes for a profile link from profile.links (keyed by its stable id, never its label). */
export function profileLinkAttrs(id: string): GaAttrs {
  return CONTACT_LINK_IDS.has(id)
    ? gaAttrs(['contact_click', 'social_click'], { contact_type: id, platform: id })
    : gaAttrs('social_click', { platform: id });
}
