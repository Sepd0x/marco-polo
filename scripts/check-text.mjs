// Text check over every tracked text file: no dashes used as punctuation,
// none of the stock phrases that make prose read as generated, no mention of
// tools that wrote code, no co-author trailers. Exits 1 with file:line for
// each hit. Data files (labels, fixtures, models, lockfiles) are skipped.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const SKIP = [
  /^package-lock\.json$/,
  /^packages\/eval\/labels\//,
  /^packages\/eval\/fixtures\//,
  /^packages\/eval\/zones\//,
  /^packages\/eval\/results\/.*\.json$/,
  /^packages\/core\/models\//,
  /^packages\/core\/test\/fixtures\//,
  /^tests\/parity\/fixtures\//,
  /^tools\/train\/courts\.geojson$/,
  /\.(png|jpe?g|webp|gif|ico|woff2?|ttf|otf|pbf|bin|f64)$/i,
];

const RULES = [
  { id: 'dash', re: /[—–]/, why: 'em or en dash as punctuation; use a comma, a colon or two sentences' },
  { id: 'phrase', re: /\b(seamless(ly)?|robust(ly|ness)?|powerful|leverag(e|es|ed|ing)|delv(e|es|ing)|cutting[- ]edge|state[- ]of[- ]the[- ]art|game[- ]chang\w*|effortless(ly)?|supercharg\w*|unlock(s|ing)? the|elevate(s|d)?|empower\w*|harness(es|ing)? the|tapestry|in today's)\b/i, why: 'stock phrase' },
  { id: 'phrase', re: /\b(it's|it is) not (just )?(a|an|about) [^.]{1,40}[,;] (it's|it is)\b/i, why: '"not X, it is Y" construction' },
  { id: 'trailer', re: /co-authored-by:/i, why: 'co-author trailer' },
  { id: 'osint', re: /\bosint\b/i, why: 'the product is described as a tool, without that word' },
];

// Names of code-writing tools, kept as the first 16 hex digits of the sha256
// of each lowercase word or phrase so this file does not list them itself.
const TOOL_HASHES = new Set(['c857d09db23e6822', 'c70eca6b0f88f44d', '60965168ce762e94', '7d3194f79e645c42', '3ea125d0bff386e6', '5d72436256ada538', '487b91042c7cf27a', 'cdcbb68a3444fdd6', '9760d607e65eafcf', '9c26adb26ee86916']);
const h16 = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);

/** The first word or phrase of up to three words in `line` whose hash is listed. */
function toolName(line) {
  const w = line.toLowerCase().match(/[a-z]+/g) ?? [];
  for (let i = 0; i < w.length; i++) {
    for (let n = 1; n <= 3 && i + n <= w.length; n++) {
      const phrase = w.slice(i, i + n).join(' ');
      if (TOOL_HASHES.has(h16(phrase))) return phrase;
    }
  }
  return null;
}

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
let hits = 0;
for (const f of files) {
  if (SKIP.some((re) => re.test(f)) || f === 'scripts/check-text.mjs') continue;
  let text;
  try {
    text = readFileSync(f, 'utf8');
  } catch {
    continue;
  }
  if (text.includes('\0')) continue;
  text.split(/\r?\n/).forEach((line, i) => {
    for (const r of RULES) {
      const m = r.re.exec(line);
      if (!m) continue;
      hits++;
      console.log(`${f}:${i + 1}: ${r.why}: "${m[0]}"`);
    }
    const tool = toolName(line);
    if (tool) {
      hits++;
      console.log(`${f}:${i + 1}: names a code-writing tool: "${tool}"`);
    }
  });
}
if (hits) {
  console.log(`${hits} hit(s)`);
  process.exit(1);
}
console.log(`text check: ${files.length} tracked files, no hits`);
