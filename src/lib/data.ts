// Loads the content YAML files at build time. Key names follow content-schema.md v1.
import { parse } from 'yaml';
import profileSrc from '../data/profile.yaml?raw';
import projectsSrc from '../data/projects.yaml?raw';
import resumeSrc from '../data/resume.yaml?raw';
import nowSrc from '../data/now.yaml?raw';

export type Locale = 'zh' | 'en';
export type Bi<T = string> = { zh: T; en: T };

export interface Profile {
  name: Bi;
  brand: Bi;
  brand_sub: string;
  handle: string;
  display: { first: string; last: string };
  headline: Bi;
  tagline: Bi;
  location: { city: Bi; timezone: string };
  intro: Bi;
  lab_intro: Bi;
  hero_badges: Bi[];
  human_intent: { line1: string; line2: string; note: Bi };
  email: string;
  links: { id: string; label: string; url: string }[];
  seo: { home_title: Bi; home_description: Bi };
  copyright_name: Bi;
}

export interface Project {
  slug: string;
  name: string;
  featured: boolean;
  order: number;
  years: string;
  category: Bi;
  summary: Bi;
  details: Bi<string[]>;
  stack: string[];
  links: { label: Bi; url: string }[];
  status: Bi;
  disclosure: Bi;
  image: string;
}

export interface Resume {
  summary: Bi;
  education: { school: Bi; degree: Bi; period: string; notes: Bi }[];
  experience: { org: Bi; role: Bi; period: string; bullets: Bi<string[]> }[];
  awards: { title: Bi; date: string; notes: Bi }[];
  skills: { group: Bi; items: string[] }[];
  pdf: string;
}

export interface Now {
  subtitle: string;
  building: string[];
  exploring: string[];
  thinking: string[];
  last_updated: string;
}

export const profile = parse(profileSrc) as Profile;
export const projects = ((parse(projectsSrc) as Project[] | null) ?? []).slice();
export const resume = parse(resumeSrc) as Resume;
export const now = parse(nowSrc) as Now;

export const featuredProjects = projects
  .filter((p) => p.featured)
  .sort((a, b) => a.order - b.order);
export const moreProjects = projects.filter((p) => !p.featured).sort((a, b) => a.order - b.order);

/** Pick the localized string; zh is the source of truth, so an empty en falls back to zh. */
export function pick(value: Bi | undefined, locale: Locale): string {
  if (!value) return '';
  const v = value[locale];
  return v && v.trim() ? v : value.zh ?? '';
}

/** First sentence of a text, for meta descriptions: drops [brackets] and spaces between CJK and Latin. */
export function firstSentence(text: string): string {
  return (text || '')
    .replace(/[\[\]]/g, '')
    .replace(/\s+(?=[\u3000-\u9fff\uff00-\uffef])|(?<=[\u3000-\u9fff\uff00-\uffef])\s+/g, '')
    .match(/^.*?(?:。|\. |\.$|$)/)?.[0].trim() ?? '';
}

/** Same as pick, for bilingual lists. */
export function pickList(value: Bi<string[]> | undefined, locale: Locale): string[] {
  if (!value) return [];
  const v = value[locale];
  return v && v.length ? v : value.zh ?? [];
}

/** The one link the home index shows: a live demo if there is one, else the repo, else the first link. */
export function primaryLink(project: Project): Project['links'][number] | undefined {
  const links = project.links.filter((l) => l.url && l.url.trim());
  const is = (l: Project['links'][number], words: string[]) =>
    words.some((w) => `${l.label.zh} ${l.label.en}`.toLowerCase().includes(w));
  return (
    links.find((l) => is(l, ['在线演示', 'live demo'])) ??
    links.find((l) => is(l, ['仓库', 'repo'])) ??
    links[0]
  );
}
