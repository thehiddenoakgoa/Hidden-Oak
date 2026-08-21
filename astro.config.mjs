// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
// Output is static by default: Cloudflare Pages serves the built `dist/` folder,
// no server-side runtime required. The only embed (Cal.com) loads client-side.
export default defineConfig({
  site: 'https://hidden-oak.pages.dev',
  output: 'static',
  integrations: [
    sitemap({
      // Internal-only pages — exclude from public sitemap
      filter: (page) => !page.includes('/style-guide') && !page.includes('/admin/'),
    }),
  ],
  // Inline small stylesheets to eliminate render-blocking CSS requests
  // (Astro already inlines CSS below a threshold; this confirms it).
  build: {
    inlineStylesheets: 'auto',
  },
});
