import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { build } from 'vite';
import { CAPTURE_LOOKUP_HOSTS, IMAGERY_PROVIDERS } from '@marco-polo/core';
import { buildCsp, LABEL_ORIGIN, SEARCH_ORIGIN } from '../../src/map/csp.js';

const webRoot = resolve(__dirname, '../..');

function directives(csp: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const part of csp.split(';')) {
    const [name, ...values] = part.trim().split(/\s+/);
    if (name) out.set(name, values);
  }
  return out;
}

describe('CSP of the production build (dist/index.html)', () => {
  let html = '';
  let dist = '';
  let csp: Map<string, string[]>;

  beforeAll(async () => {
    const outDir = (dist = mkdtempSync(join(tmpdir(), 'mp-csp-')));
    await build({
      root: webRoot,
      configFile: join(webRoot, 'vite.config.ts'),
      base: '/marco-polo/',
      logLevel: 'silent',
      build: { outDir, emptyOutDir: true },
    });
    html = readFileSync(join(outDir, 'index.html'), 'utf8');
    const m = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html);
    expect(m, 'no CSP meta tag in dist/index.html').not.toBeNull();
    csp = directives(m![1]);
  }, 120_000);

  it('is the policy the builder makes', () => {
    expect(html).toContain(buildCsp());
  });

  it('lets every imagery source through connect-src and img-src', () => {
    for (const p of IMAGERY_PROVIDERS) {
      for (const t of p.mirror ? [p.template, p.mirror] : [p.template]) {
        const origin = new URL(t.replace(/\{[^}]*\}/g, '0')).origin;
        expect(csp.get('connect-src'), p.id).toContain(origin);
        expect(csp.get('img-src'), p.id).toContain(origin);
      }
    }
    expect(csp.get('connect-src')).toContain('https://tms-pnoa-ma.idee.es');
  });

  it('lets the date lookups, the labels and the search through connect-src', () => {
    for (const h of [...CAPTURE_LOOKUP_HOSTS, LABEL_ORIGIN, SEARCH_ORIGIN]) expect(csp.get('connect-src')).toContain(h);
  });

  it('has no wildcard and none of the removed services', () => {
    const all = [...csp.values()].flat();
    expect(all).not.toContain('https:');
    expect(all).not.toContain('*');
    for (const gone of ['api.github.com', 'mapbox', 'maptiler', 'googleapis']) {
      expect(all.some((v) => v.includes(gone)), gone).toBe(false);
    }
  });

  it('keeps scripts to the app itself and blocks plugins and forms', () => {
    expect(csp.get('script-src')).toEqual(["'self'"]);
    expect(csp.get('object-src')).toEqual(["'none'"]);
    expect(csp.get('form-action')).toEqual(["'none'"]);
  });

  it('loads its assets under the Pages base path', () => {
    expect(html).toMatch(/src="\/marco-polo\/assets\/index-[\w-]+\.js"/);
  });

  it('keeps MapLibre in its own chunk, the only thing the chunk size limit is raised for', () => {
    // MapLibre is one module of about 1 MB and cannot be cut below the default
    // 500 kB. The limit may sit just above it; a higher one would hide the
    // warning for the app's own code too. (This build runs under NODE_ENV=test,
    // so sizes here are not the production ones; `npm run build` is the check.)
    const chunks = readdirSync(join(dist, 'assets')).filter((f) => f.endsWith('.js'));
    expect(chunks.filter((f) => f.startsWith('maplibre-'))).toHaveLength(1);
    const limit = /chunkSizeWarningLimit:\s*(\d+)/.exec(readFileSync(join(webRoot, 'vite.config.ts'), 'utf8'));
    expect(limit, 'a limit set for MapLibre').not.toBeNull();
    expect(Number(limit![1])).toBeLessThanOrEqual(1100);
  });
});
