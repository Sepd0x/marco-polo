/*
 * Read source files from the web app. The web project has no Node types, so
 * the two fs calls used here are typed by hand.
 */
type Fs = {
  readFileSync(path: string, encoding: 'utf8'): string;
  readdirSync(path: string): string[];
};

const fs = (await import('node:' + 'fs')) as Fs;

// Under jsdom the module URL can come as file:///C:/..., /@fs/C:/... or /home/...; keep the path part.
const here = decodeURIComponent(import.meta.url)
  .replace(/^file:\/\//, '')
  .replace(/^\/@fs/, '')
  .replace(/^\/([A-Za-z]:\/)/, '$1');

/** apps/web/ */
const ROOT = here.slice(0, here.lastIndexOf('/test/ui/') + 1);

export const readText = (rel: string): string => fs.readFileSync(ROOT + rel, 'utf8');

/** Files in a folder of the web app, as paths relative to apps/web/. */
export const listFiles = (dir: string, ext = ''): string[] =>
  fs
    .readdirSync(ROOT + dir)
    .filter((f) => f.endsWith(ext) && f.includes('.'))
    .map((f) => `${dir}/${f}`);
