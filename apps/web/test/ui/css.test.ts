import { describe, expect, it } from 'vitest';
import { contrastRatio } from '../../src/lib/theme.js';

import { listFiles, readText } from './files.js';

const STYLES = Object.fromEntries(listFiles('src/styles', '.css').map((f) => [f, readText(f)]));
const COMPONENTS = Object.fromEntries(listFiles('src/ui', '.tsx').map((f) => [f, readText(f)]));
const style = (name: string) => readText(`src/styles/${name}`);

function tokens(css: string, selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`no block ${selector}`);
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/gi)) out[m[1]] = m[2].toLowerCase();
  return out;
}

const css = style('tokens.css');
const light = tokens(css, ':root {');
const darkOverrides = tokens(css, ":root[data-theme='dark'] {");
const dark = { ...light, ...darkOverrides };

/** Text colour on background. Every text token on every surface it is used on. */
const TEXT_PAIRS: [string, string][] = [
  ['ink', 'panel'],
  ['ink', 'ground'],
  ['ink', 'panel-2'],
  ['ink', 'hover'],
  ['ink', 'pool-wash'],
  ['ink-2', 'panel'],
  ['ink-2', 'hover'],
  ['ink-2', 'panel-2'],
  ['ink-3', 'panel'],
  ['ink-3', 'panel-2'],
  ['ink-3', 'hover'],
  ['ink-3', 'pool-wash'],
  ['pool-text', 'panel'],
  ['pool-text', 'pool-wash'],
  ['pool-ink', 'pool'],
  ['danger', 'panel'],
  ['panel', 'ink'],
];

describe('colour tokens', () => {
  for (const [name, theme] of [
    ['light', light],
    ['dark', dark],
  ] as const) {
    it(`gives text at least 4.5:1 in the ${name} theme`, () => {
      for (const [fg, bg] of TEXT_PAIRS) {
        const ratio = contrastRatio(theme[fg], theme[bg]);
        expect(ratio, `${fg} on ${bg}: ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
      }
    });

    it(`gives field borders at least 3:1 in the ${name} theme`, () => {
      expect(contrastRatio(theme.edge, theme.panel)).toBeGreaterThanOrEqual(3);
    });
  }

  it('keeps the system dark block identical to the toggle one', () => {
    const media = css.slice(css.indexOf('@media (prefers-color-scheme: dark)'));
    expect(tokens(media, ":root:not([data-theme='light']) {")).toEqual(darkOverrides);
  });

  it('keeps the pool colour and its casing apart', () => {
    expect(contrastRatio(light.pool, light.casing)).toBeGreaterThan(14);
  });
});

describe('type size', () => {
  it('never sets text below 12 px in the styles', () => {
    expect(Object.keys(STYLES).length).toBeGreaterThanOrEqual(4);
    for (const [f, text] of Object.entries(STYLES)) {
      for (const m of text.matchAll(/font(?:-size)?:[^;]*?(\d+(?:\.\d+)?)px/g)) {
        expect(Number(m[1]), `${f}: ${m[0]}`).toBeGreaterThanOrEqual(12);
      }
      for (const m of text.matchAll(/font-size:\s*(\d*\.?\d+)(rem|em)/g)) {
        expect(Number(m[1]) * 13, `${f}: ${m[0]}`).toBeGreaterThanOrEqual(12);
      }
    }
  });

  it('fails on a stylesheet that does', () => {
    const bad = '.x { font-size: 9px; }';
    const m = [...bad.matchAll(/font(?:-size)?:[^;]*?(\d+(?:\.\d+)?)px/g)];
    expect(Number(m[0][1])).toBeLessThan(12);
  });

  it('never sets a font size inline in the components', () => {
    for (const [f, text] of Object.entries(COMPONENTS)) expect(text, f).not.toMatch(/fontSize/);
  });
});

describe('motion', () => {
  it('turns the moving parts off for reduced motion', () => {
    const app = style('app.css');
    const block = app.slice(app.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(block).toMatch(/\.row\.new\s*{\s*animation: none/);
  });
});

describe('focus', () => {
  it('draws a visible ring on keyboard focus, in a text colour that passes contrast', () => {
    const base = style('base.css');
    expect(base).toMatch(/:focus-visible\s*{\s*outline: 2px solid var\(--pool-text\)/);
    expect(contrastRatio(light['pool-text'], light.panel)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(dark['pool-text'], dark.panel)).toBeGreaterThanOrEqual(3);
  });
});
