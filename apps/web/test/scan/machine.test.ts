import { describe, expect, it } from 'vitest';
import { phaseOf, ScanMachine, transition } from '../../src/scan/machine.js';

describe('scan state machine', () => {
  it('allows only the planned moves', () => {
    expect(transition('created', 'pause')).toBeNull();
    expect(transition('running', 'pause')).toBe('paused');
    expect(transition('paused', 'pause')).toBeNull();
    expect(transition('paused', 'finish')).toBeNull();
    expect(transition('stopping', 'resume')).toBeNull();
    expect(transition('done', 'retry')).toBe('running');
    expect(transition('done', 'pause')).toBeNull();
    for (const s of ['created', 'running', 'paused', 'stopping', 'done'] as const) expect(transition(s, 'dispose')).toBe('disposed');
    expect(transition('disposed', 'start')).toBeNull();
  });

  it('maps states to store phases', () => {
    expect(phaseOf('running')).toBe('scanning');
    expect(phaseOf('stopping')).toBe('scanning');
    expect(phaseOf('paused')).toBe('paused');
    expect(phaseOf('done')).toBe('complete');
    expect(phaseOf('disposed')).toBeNull();
  });

  it('tells listeners about each change and ignores refused events', () => {
    const m = new ScanMachine();
    const seen: string[] = [];
    m.onChange((s, from) => seen.push(`${from}>${s}`));
    expect(m.send('pause')).toBe(false);
    m.send('start');
    m.send('pause');
    m.send('resume');
    m.send('stop');
    m.send('finish');
    expect(seen).toEqual(['created>running', 'running>paused', 'paused>running', 'running>stopping', 'stopping>done']);
    expect(m.can('retry')).toBe(true);
  });
});
