import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: '/Obsidian-web/',

  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff,woff2,ttf,eot}'],
        navigateFallback: '/Obsidian-web/index.html',
        navigateFallbackAllowlist: [/^\/Obsidian-web\//],
      },
      manifest: false,
    }),
  ],
});
