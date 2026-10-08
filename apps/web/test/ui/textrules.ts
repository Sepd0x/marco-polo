/*
 * Words kept out of the interface and out of this part of the repo, stored as
 * FNV-1a hashes so the list itself never lands in the source.
 */

/** Jargon the interface must not use (old HUD words, and the uncalibrated "c" word for the score). */
const UI_JARGON = new Set([
  'a201d624',
  '518432e3',
  '78395bb5',
  '676401da',
  'adc649b8',
  '9481fed0',
  'a52bcaf9',
  '302c3530',
  '21c08419',
  'd458ccd1',
  'c0d0af80',
  '8ff60339',
  'a353951b',
  'e0f4bf1e',
]);

/** Words that make text read as machine written, plus one term the project never uses. */
const REPO_WORDS = new Set([
  '139a9046',
  'b3c551d9',
  '8c6f368c',
  '265d3822',
  '5a91246d',
  '5afb52c3',
  '8ff60339',
  '9a67fb30',
  'c0d0af80',
  '518432e3',
  'de9a27f2',
  '9cb73c2e',
  'd2875a78',
]);

export function fnv1a(word: string): string {
  let h = 0x811c9dc5;
  for (const b of new TextEncoder().encode(word)) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function hits(text: string, set: Set<string>): string[] {
  const words = text.toLowerCase().match(/[a-z]+(?:-[a-z]+)*/g) ?? [];
  const found: string[] = [];
  for (const w of words) {
    if (set.has(fnv1a(w))) found.push(w);
    for (const part of w.split('-')) if (part !== w && set.has(fnv1a(part))) found.push(part);
  }
  return found;
}

export const jargonIn = (text: string) => hits(text, UI_JARGON);
export const repoWordsIn = (text: string) => hits(text, REPO_WORDS);

export { DASHES } from './dashes.js';
