import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { localePath } from '../i18n';

export const GET: APIRoute = async ({ site }) => {
  const posts = (await getCollection('blog')).sort(
    (a, b) => b.data.date.getTime() - a.data.date.getTime() || a.id.localeCompare(b.id),
  );
  const feed = {
    version: 'https://jsonfeed.org/version/1.1',
    title: 'Doctor Zero — Blog',
    home_page_url: new URL('/blog/', site).href,
    feed_url: new URL('/feed.json', site).href,
    description: 'Article summaries and links from Doctor Zero’s personal website.',
    items: posts.map((post) => {
      const url = new URL(localePath(post.data.lang, `blog/${post.id}`), site).href;
      return {
        id: url,
        url,
        title: post.data.title,
        content_text: post.data.description,
        summary: post.data.description,
        date_published: post.data.date.toISOString(),
        language: post.data.lang === 'zh' ? 'zh-CN' : 'en',
      };
    }),
  };
  return new Response(JSON.stringify(feed, null, 2), {
    headers: { 'Content-Type': 'application/feed+json; charset=utf-8' },
  });
};
