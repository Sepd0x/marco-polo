import { defineConfig, type PluginOption } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Content-Security-Policy, production builds only (the dev server needs
 * inline preambles and websockets that a strict CSP would break).
 * connect-src https: covers imagery tiles, Nominatim and the GitHub API.
 */
const csp: PluginOption = {
  name: 'inject-csp',
  apply: 'build',
  transformIndexHtml(html) {
    const content = [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      'connect-src https:',
      "worker-src 'self' blob:",
      "font-src 'self' data:", // MapLibre ships a fallback glyph font as a data URI
      "base-uri 'self'",
      "form-action 'none'",
      "object-src 'none'",
    ].join('; ');
    return html.replace(
      '<head>',
      `<head>\n    <meta http-equiv="Content-Security-Policy" content="${content}" />`,
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
    chunkSizeWarningLimit: 1500,
  },
});
