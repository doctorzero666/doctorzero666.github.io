import { getCollection, type CollectionEntry } from 'astro:content';
import type { Locale } from './data';

// True when src/content/blog holds at least one post. Checked at build time so that
// an empty blog skips getCollection() (which otherwise logs an "empty collection" warning).
const postFiles = import.meta.glob('/src/content/blog/**/*.{md,mdx}');
export const hasPosts = Object.keys(postFiles).length > 0;

export async function getPosts(locale: Locale): Promise<CollectionEntry<'blog'>[]> {
  if (!hasPosts) return [];
  return getCollection('blog', (p) => p.data.lang === locale);
}
