import { defineCollection } from 'astro:content';
import { glob, type Loader } from 'astro/loaders';
import { z } from 'astro/zod';

const BLOG_DIR = './src/content/blog';
const hasPosts = Object.keys(import.meta.glob('/src/content/blog/**/*.{md,mdx}')).length > 0;

// Blog posts: Markdown files in src/content/blog/. One file per language version.
// While the folder holds no posts the glob loader is skipped, so the build does not
// warn about an empty match (pages read posts through src/lib/blog.ts, which also
// short-circuits). After adding the first post, restart the dev server once.
const blogGlob = glob({ pattern: '**/*.{md,mdx}', base: BLOG_DIR });
const blogLoader: Loader = {
  name: 'blog-loader',
  load: async (context) => {
    if (hasPosts) return blogGlob.load(context);
    context.store.clear();
  },
};

const blog = defineCollection({
  loader: blogLoader,
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    lang: z.enum(['zh', 'en']),
    description: z.string(),
  }),
});

export const collections = { blog };
