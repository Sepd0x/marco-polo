import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Shell } from '../../src/ui/Shell.js';
import { ErrorBoundary } from '../../src/ui/ErrorBoundary.js';
import { useStore } from '../../src/state/store.js';
import { emit } from '../../src/lib/bus.js';
import { asPhone, mount, readableText, seed, type Mounted, type Phase } from './fixtures.js';
import { DASHES, jargonIn, repoWordsIn } from './textrules.js';
import { listFiles, readText } from './files.js';

let m: Mounted | null = null;
const render = () => (m = mount(<Shell map={null} />));
const q = <T extends Element = HTMLElement>(sel: string) => m!.host.querySelector<T>(sel);
const qa = (sel: string) => [...m!.host.querySelectorAll<HTMLElement>(sel)];
const byText = (sel: string, text: string | RegExp) =>
  qa(sel).find((el) => (typeof text === 'string' ? el.textContent?.trim() === text : text.test(el.textContent ?? '')));
const click = (el: Element | null | undefined) => {
  if (!el) throw new Error('nothing to click');
  act(() => (el as HTMLElement).click());
};
const key = (target: EventTarget, k: string) =>
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
  });

beforeEach(() => asPhone(false));
afterEach(() => {
  m?.unmount();
  m = null;
});

const PHASES: Phase[] = ['idle', 'ready', 'scanning', 'paused', 'complete'];
const ALLOWED = /^[\x20-\x7e²×·óé]*$/;

describe('interface text', () => {
  for (const phone of [false, true]) {
    for (const phase of PHASES) {
      it(`is plain English with no dashes or jargon: ${phase}, ${phone ? 'phone' : 'desktop'}`, () => {
        asPhone(phone);
        seed(phase, phase === 'complete' ? { selectedId: 'a' } : {});
        render();
        const texts = readableText(m!.host);
        expect(texts.length).toBeGreaterThan(5);
        for (const t of texts) {
          expect(t, t).not.toMatch(DASHES);
          expect(t, t).toMatch(ALLOWED);
          expect(jargonIn(t), t).toEqual([]);
          expect(repoWordsIn(t), t).toEqual([]);
        }
      });
    }
  }

  it('calls the number a score', () => {
    seed('complete', { selectedId: 'a' });
    render();
    expect(m!.host.textContent).toContain('Score');
  });
});

describe('source files of the interface', () => {
  const names = [
    ...listFiles('src/ui'),
    ...listFiles('src/styles', '.css'),
    ...['format', 'theme', 'demoAreas', 'links'].map((f) => `src/lib/${f}.ts`),
    'src/App.tsx',
    'src/main.tsx',
    'index.html',
    ...listFiles('test/ui'),
  ];
  const files = Object.fromEntries(names.map((f) => [f, readText(f)]));

  it('have no dashes, banners or the words kept out of the repo', () => {
    expect(Object.keys(files).length).toBeGreaterThan(25);
    for (const [f, text] of Object.entries(files)) {
      expect(text, f).not.toMatch(DASHES);
      expect(repoWordsIn(text), f).toEqual([]);
    }
  });

  it('do not ask GitHub for updates any more', () => {
    for (const [f, text] of Object.entries(files)) expect(text, f).not.toMatch(/api\.github\.com/);
  });
});

describe('one count', () => {
  it('shows the same number in the summary, the list header and the list', () => {
    seed('complete');
    render();
    const big = q('.big b')!.textContent;
    const header = q('#list-h .count')!.textContent;
    expect(big).toBe('4');
    expect(header).toBe('4');
    expect(qa('[role="option"]')).toHaveLength(4);
    expect(q('.more')!.textContent).toContain('1 more scored below 0.55.');
  });

  it('"Show it" brings the pool below the threshold into the list', () => {
    seed('complete');
    render();
    click(byText('button', 'Show it'));
    expect(useStore.getState().settings.minConfidence).toBe(0.4);
    expect(q('.big b')!.textContent).toBe('5');
    expect(q('.more')!.textContent).toBe('None below 0.40.');
  });

  it('says which imagery was scanned and that the map shows it', () => {
    seed('complete');
    render();
    const line = q('.imgline')!.textContent!;
    expect(line).toContain('The map inside your area shows this same imagery.');
    expect(line).toMatch(/Esri World Imagery|DGT Ortos2025/);
  });

  it('tells a stopped scan apart from a finished one', () => {
    seed('complete', { stats: { ...useStore.getState().stats, tilesDone: 12 } });
    render();
    expect(q('#sum-h')!.textContent).toBe('Scan stopped');
  });
});

describe('progress', () => {
  it('shows one cell per tile and the count of tiles', () => {
    seed('scanning');
    render();
    expect(qa('.cells i')).toHaveLength(40);
    expect(qa('.cells i.done')).toHaveLength(26);
    expect(q('.prog-row span')!.textContent).toBe('26 of 40 tiles');
    expect(q('[role="progressbar"]')!.getAttribute('aria-valuenow')).toBe('26');
    expect(byText('button', 'Pause')).toBeTruthy();
    expect(byText('button', 'Stop')).toBeTruthy();
  });

  it('becomes a continuous bar above 80 tiles', () => {
    seed('scanning', { stats: { ...useStore.getState().stats, tilesTotal: 400, tilesDone: 100 } });
    render();
    expect(qa('.cells i')).toHaveLength(0);
    expect(q('.bar-line')).toBeTruthy();
  });

  it('says Paused and offers Resume', () => {
    seed('paused');
    render();
    expect(q('#prog-h')!.textContent).toBe('Paused');
    expect(byText('button', 'Resume')).toBeTruthy();
  });

  it('marks the pool from the latest tile as new', () => {
    seed('scanning');
    render();
    expect(qa('.new-tag')).toHaveLength(1);
  });
});

describe('pool list and inspector', () => {
  it('moves the selection with the arrow keys and clears it with Esc', () => {
    seed('complete');
    render();
    const list = q('[role="listbox"]')!;
    key(list, 'ArrowDown');
    expect(useStore.getState().selectedId).toBe('a');
    key(list, 'ArrowDown');
    expect(useStore.getState().selectedId).toBe('b');
    expect(list.getAttribute('aria-activedescendant')).toBe('pool-b');
    key(list, 'End');
    expect(useStore.getState().selectedId).toBe('e');
    key(window, 'Escape');
    expect(useStore.getState().selectedId).toBeNull();
  });

  it('sorts by score with a pressed segment', () => {
    seed('complete');
    render();
    const score = qa('.seg button').find((b) => b.textContent === 'Score')!;
    click(score);
    expect(score.getAttribute('aria-pressed')).toBe('true');
    expect(qa('[role="option"] .n').map((n) => n.textContent)).toEqual(['1', '3', '4', '2']);
  });

  it('shows measured size, the score and a secondary Google Maps link', () => {
    seed('complete', { selectedId: 'a' });
    render();
    const insp = q('.insp')!;
    expect(insp.getAttribute('role')).toBe('dialog');
    expect(insp.textContent).toContain('Pool #1');
    expect(insp.textContent).toContain('10.0 × 5.0 m from outline');
    expect(insp.textContent).toContain('0.91');
    const link = [...insp.querySelectorAll('a')].find((a) => a.textContent?.includes('Open in Google Maps'))!;
    expect(link.href).toMatch(/^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=-?\d+\.\d{6}%2C-?\d+\.\d{6}$/);
    expect(link.className).not.toContain('primary');
  });

  it('says "Size not measured" for a pool cut by the imagery edge', () => {
    seed('complete', { selectedId: 'd' });
    render();
    expect(q('.insp')!.textContent).toContain('Size not measured');
    expect(q('.insp')!.textContent).not.toContain('from outline');
  });

  it('steps to the next pool in list order', () => {
    seed('complete', { selectedId: 'a' });
    render();
    click(q('[aria-label="Next pool"]'));
    expect(useStore.getState().selectedId).toBe('b');
    click(q('[aria-label="Previous pool"]'));
    click(q('[aria-label="Previous pool"]'));
    expect(useStore.getState().selectedId).toBe('e');
  });
});

describe('drawing and keys', () => {
  it('scans the current view from the keyboard', () => {
    seed('idle');
    render();
    act(() => emit('view', { bbox: [-8.12, 37.07, -8.11, 37.08], zoom: 17 }));
    const btn = byText('button', /Scan this view/)!;
    expect(btn.hasAttribute('disabled')).toBe(false);
    key(window, 'v');
    expect(useStore.getState().phase).toBe('ready');
    expect(useStore.getState().area).toHaveLength(4);
  });

  it('starts and cancels drawing with R and Esc', () => {
    seed('idle');
    render();
    key(window, 'r');
    expect(useStore.getState().drawMode).toBe('rect');
    expect(byText('button', /Rectangle/)!.getAttribute('aria-pressed')).toBe('true');
    key(window, 'Escape');
    expect(useStore.getState().drawMode).toBeNull();
  });

  it('blocks an area over the limit', () => {
    seed('ready', {
      area: [
        [-8.3, 37.0],
        [-8.0, 37.0],
        [-8.0, 37.2],
        [-8.3, 37.2],
      ],
    });
    render();
    expect(q('[role="alert"]')!.textContent).toContain('Too large to scan');
    expect(byText('button', 'Start scan')!.hasAttribute('disabled')).toBe(true);
  });
});

describe('settings', () => {
  it('opens as a modal dialog and closes with Esc', () => {
    seed('idle');
    render();
    const opener = q<HTMLButtonElement>('[aria-label="Settings"]')!;
    opener.focus();
    click(opener);
    const dialog = document.querySelector('[role="dialog"][aria-modal="true"]')!;
    expect(dialog).toBeTruthy();
    expect(dialog.contains(document.activeElement)).toBe(true);
    key(window, 'Escape');
    expect(document.querySelector('[aria-modal="true"]')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('offers only scan-allowed sources and no zoom or colour picker', () => {
    seed('ready');
    render();
    click(q('[aria-label="Settings"]'));
    const text = document.querySelector('[role="dialog"]')!.textContent!;
    expect(text).toContain('Auto');
    expect(text).not.toMatch(/OrtoSat|Mapbox|MapTiler|zoom|Accent/i);
  });
});

describe('phone', () => {
  it('keeps the map full screen with a sheet and a pill that opens the list', () => {
    asPhone(true);
    seed('complete');
    render();
    expect(q('.side')).toBeNull();
    const pill = q('.pill')!;
    expect(pill.textContent).toContain('4 pools');
    click(pill);
    expect(pill.getAttribute('aria-expanded')).toBe('true');
    expect(qa('[role="option"]')).toHaveLength(4);
    click(qa('[role="option"]')[1]);
    expect(useStore.getState().selectedId).toBe('b');
    expect(q('.m-card')!.textContent).toContain('Pool #2');
  });
});

describe('error boundary', () => {
  it('shows a way back instead of a blank page', () => {
    const Boom = () => {
      throw new Error('broken on purpose');
    };
    const spy = console.error;
    console.error = () => {};
    const quiet = (e: ErrorEvent) => e.preventDefault();
    window.addEventListener('error', quiet);
    try {
      m = mount(
        <ErrorBoundary>
          <Boom />
        </ErrorBoundary>,
      );
    } finally {
      console.error = spy;
      window.removeEventListener('error', quiet);
    }
    expect(q('[role="alert"]')!.textContent).toContain('Something went wrong');
    expect(byText('button', 'Reload the page')).toBeTruthy();
  });
});
