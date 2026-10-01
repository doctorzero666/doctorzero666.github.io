// @ts-check
import { defineConfig } from 'astro/config';

// GitHub Pages user site: https://doctorzero666.github.io (served from root, no base path).
export default defineConfig({
  site: 'https://doctorzero666.github.io',
  trailingSlash: 'ignore',
  build: { format: 'directory' },
  i18n: {
    defaultLocale: 'zh',
    locales: ['zh', 'en'],
    routing: { prefixDefaultLocale: false },
  },
});
