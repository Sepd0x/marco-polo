import { afterEach } from 'vitest';

// Each test starts from empty storage, as a first visit would.
afterEach(() => {
  localStorage.clear();
});
