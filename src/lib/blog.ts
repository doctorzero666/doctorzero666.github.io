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

export type NumberedPost = { post: CollectionEntry<'blog'>; tx: string };

/**
 * Posts of one locale with a stable transmission number. Numbers are assigned oldest first
 * (the earliest post is TX-001), so adding a post never shifts existing numbers; the list
 * comes back newest first for display.
 */
export async function getNumberedPosts(locale: Locale): Promise<NumberedPost[]> {
  const asc = (await getPosts(locale)).sort(
    (a, b) => a.data.date.getTime() - b.data.date.getTime() || a.id.localeCompare(b.id),
  );
  return asc.map((post, i) => ({ post, tx: `TX-${String(i + 1).padStart(3, '0')}` })).reverse();
}

/** The TX number of one post within its locale, e.g. "TX-003". */
export async function txOf(post: CollectionEntry<'blog'>): Promise<string> {
  return (await getNumberedPosts(post.data.lang)).find((n) => n.post.id === post.id)?.tx ?? '';
}
