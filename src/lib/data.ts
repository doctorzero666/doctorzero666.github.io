// Loads the three content YAML files at build time. Key names follow content-schema.md v1.
import { parse } from 'yaml';
import profileSrc from '../data/profile.yaml?raw';
import projectsSrc from '../data/projects.yaml?raw';
import resumeSrc from '../data/resume.yaml?raw';

export type Locale = 'zh' | 'en';
export type Bi<T = string> = { zh: T; en: T };

export interface Profile {
  name: Bi;
  display: { first: string; last: string };
  headline: Bi;
  tagline: Bi;
  location: { city: Bi; timezone: string };
  intro: Bi;
  hero_badges: Bi[];
  email: string;
  links: { id: string; label: string; url: string }[];
  footer_plate: Bi;
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

export const profile = parse(profileSrc) as Profile;
export const projects = ((parse(projectsSrc) as Project[] | null) ?? []).slice();
export const resume = parse(resumeSrc) as Resume;

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

/** Same as pick, for bilingual lists. */
export function pickList(value: Bi<string[]> | undefined, locale: Locale): string[] {
  if (!value) return [];
  const v = value[locale];
  return v && v.length ? v : value.zh ?? [];
}
