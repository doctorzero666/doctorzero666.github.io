import zh from './zh.json';
import en from './en.json';
import type { Locale } from '../lib/data';

const dict = { zh, en } as const;
export type UI = typeof zh;

export const locales: Locale[] = ['zh', 'en'];
export const htmlLang: Record<Locale, string> = { zh: 'zh-CN', en: 'en' };

export function useUI(locale: Locale): UI {
  return dict[locale] as UI;
}

/** Path for a page in a given locale. `page` is '' | 'resume' | 'portfolio' | 'blog' | 'now' | 'blog/slug'. */
export function localePath(locale: Locale, page = ''): string {
  const clean = page.replace(/^\/+|\/+$/g, '');
  const prefix = locale === 'zh' ? '' : `/${locale}`;
  return clean ? `${prefix}/${clean}/` : `${prefix}/`;
}

/** Strip any locale prefix from a pathname, returning the page part ('' for home). */
export function pageFromPath(pathname: string): string {
  return pathname.replace(/^\/en(?=\/|$)/, '').replace(/^\/+|\/+$/g, '');
}

export function localeFromPath(pathname: string): Locale {
  return /^\/en(\/|$)/.test(pathname) ? 'en' : 'zh';
}
