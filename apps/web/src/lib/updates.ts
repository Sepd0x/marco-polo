/**
 * Update notifier for the static deployment.
 *
 * Every production build embeds the commit it was built from (VITE_COMMIT,
 * set by the Pages workflow). The running app periodically asks the GitHub API
 * for the tip of main; when they diverge, a newer build is live and the UI
 * offers a one-click reload. Dev builds skip all of this.
 */

const REPO = 'Sepd0x/marco-polo';
const CHECK_INTERVAL_MS = 30 * 60_000;

export const BUILD_COMMIT: string = (import.meta.env.VITE_COMMIT as string | undefined) ?? 'dev';

export function startUpdateChecker(onUpdate: (sha: string) => void): () => void {
  if (!import.meta.env.PROD || BUILD_COMMIT === 'dev') return () => {};
  let stopped = false;

  const check = async () => {
    try {
      const res = await fetch(`https://api.github.com/repos/${REPO}/commits/main`, {
        headers: { Accept: 'application/vnd.github+json' },
      });
      if (!res.ok) return;
      const data = (await res.json()) as { sha?: string };
      if (!stopped && data.sha && data.sha !== BUILD_COMMIT) onUpdate(data.sha);
    } catch {
      // offline or rate-limited — try again next interval
    }
  };

  const first = setTimeout(check, 20_000);
  const interval = setInterval(check, CHECK_INTERVAL_MS);
  return () => {
    stopped = true;
    clearTimeout(first);
    clearInterval(interval);
  };
}
