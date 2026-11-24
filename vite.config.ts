import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig} from 'vite';
import {VitePWA, type ManifestOptions} from 'vite-plugin-pwa';

type ExtendedManifestOptions = Partial<ManifestOptions> & {
  note_taking?: {
    new_note_url: string;
  };
};

export default defineConfig(() => {
  const pwaManifest: ExtendedManifestOptions = {
    id: '/',
    name: 'buh.',
    short_name: 'buh.',
    description:
      'Calm, adaptive daily planner, tasks, notes, and live web lookup designed for Samsung Galaxy Z Fold.',
    theme_color: '#FAFAF8',
    background_color: '#FAFAF8',
    display: 'standalone',
    display_override: ['standalone'],
    orientation: 'any',
    start_url: '/',
    scope: '/',
    prefer_related_applications: false,
    launch_handler: {
      client_mode: ['focus-existing', 'auto'],
    },
    categories: ['productivity', 'utilities'],
    note_taking: {
      new_note_url: '/?shortcut=new-note',
    },
    shortcuts: [
      {
        name: 'New Task',
        short_name: 'New Task',
        description: 'Quickly create a new task in buh.',
        url: '/?shortcut=new-task',
        icons: [
          {
            src: '/shortcut-task-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
        ],
      },
      {
        name: 'New Note',
        short_name: 'New Note',
        description: 'Start writing a new blank note in buh.',
        url: '/?shortcut=new-note',
        icons: [
          {
            src: '/shortcut-note-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
        ],
      },
    ],
    icons: [
      {
        src: '/pwa-192x192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/pwa-512x512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/pwa-maskable-512x512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/badge-96x96.png',
        sizes: '96x96',
        type: 'image/png',
        purpose: 'monochrome',
      },
    ],
  };

  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        strategies: 'injectManifest',
        srcDir: 'src',
        filename: 'sw.ts',
        registerType: 'autoUpdate',
        includeAssets: [
          'favicon.ico',
          'apple-touch-icon.png',
          'icon.svg',
          'pwa-192x192.png',
          'pwa-512x512.png',
          'pwa-maskable-512x512.png',
          'badge-96x96.png',
          'shortcut-task-192.png',
          'shortcut-note-192.png',
          '.well-known/assetlinks.json',
        ],
        manifest: pwaManifest as Partial<ManifestOptions>,
        injectManifest: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2,json}'],
          maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        },
        devOptions: {
          enabled: true,
          type: 'module',
        },
      }),
      // Copies src/assets into dist/ so root-relative URLs like
      // "/src/assets/images/..." (e.g. generate_image output) still resolve
      // in production builds. Do not remove.
      {
        name: 'copy-unbundled-src-assets',
        apply: 'build',
        closeBundle(error?: Error): void {
          if (error) {
            return;
          }
          const distDir = path.resolve(__dirname, 'dist');
          const srcAssets = path.resolve(__dirname, 'src/assets');
          const distAssets = path.resolve(distDir, 'src/assets');
          if (fs.existsSync(distDir) && fs.existsSync(srcAssets)) {
            fs.cpSync(srcAssets, distAssets, {recursive: true, force: true});
          }
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
