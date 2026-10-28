import { afterEach } from 'vitest';

// Each test starts from empty storage, as a first visit would (Node-environment tests have none).
afterEach(() => {
  globalThis.localStorage?.clear();
});
