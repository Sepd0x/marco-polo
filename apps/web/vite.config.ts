import { defineConfig, type PluginOption } from 'vite';
import react from '@vitejs/plugin-react';
import { buildCsp } from './src/map/csp.js';

/**
 * Content-Security-Policy, production builds only: the dev server needs
 * inline preambles and websockets that a strict policy would break. The
 * allowed origins come from the imagery source registry in the core.
 */
const csp: PluginOption = {
  name: 'inject-csp',
  apply: 'build',
  transformIndexHtml(html) {
    return html.replace(
      '<head>',
      `<head>\n    <meta http-equiv="Content-Security-Policy" content="${buildCsp()}" />`,
    );
  },
};

export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [react(), csp],
  server: {
    port: 5173,
  },
  build: {
    target: 'es2022',
  },
});
