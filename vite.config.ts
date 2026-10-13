import { sites } from '@openai/sites-vite-plugin';
import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';
import { defineConfig } from 'vite';
import { localApi } from './server/api.mjs';

// The app stores data in an actual local SQLite file, so its API runs in Node.
export default defineConfig({
  css: { postcss: { plugins: [tailwindcss()] } },
  server: { host: '127.0.0.1', port: 3000, strictPort: true },
  plugins: [localApi(), vinext(), sites()],
});
