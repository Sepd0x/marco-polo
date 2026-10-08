/**
 * The one state machine of a scan. The controller asks it before every move
 * and the store's phase is derived from it, so pause, stop, archive and reset
 * cannot leave the scan in a state the code did not plan for.
 *
 *   created  -start->   running  -pause->  paused  -resume->  running
 *   running or paused  -stop->  stopping  -finish->  done
 *   running  -finish->  done  -retry->  running   (retry the failed tiles)
 *   any state  -dispose->  disposed   (archive opened, reset, new scan)
 */

export type ScanState = 'created' | 'running' | 'paused' | 'stopping' | 'done' | 'disposed';
export type ScanEvent = 'start' | 'pause' | 'resume' | 'stop' | 'finish' | 'retry' | 'dispose';

const TABLE: Record<ScanState, Partial<Record<ScanEvent, ScanState>>> = {
  created: { start: 'running', dispose: 'disposed' },
  running: { pause: 'paused', stop: 'stopping', finish: 'done', dispose: 'disposed' },
  paused: { resume: 'running', stop: 'stopping', dispose: 'disposed' },
  stopping: { finish: 'done', dispose: 'disposed' },
  done: { retry: 'running', dispose: 'disposed' },
  disposed: {},
};

/** Next state, or null when the event is not allowed in this state. */
export function transition(state: ScanState, event: ScanEvent): ScanState | null {
  return TABLE[state][event] ?? null;
}

/** Store phase shown for a scan state; null means the scan no longer owns the store. */
export function phaseOf(state: ScanState): 'scanning' | 'paused' | 'complete' | null {
  switch (state) {
    case 'created':
    case 'running':
    case 'stopping':
      return 'scanning';
    case 'paused':
      return 'paused';
    case 'done':
      return 'complete';
    case 'disposed':
      return null;
  }
}

export class ScanMachine {
  private current: ScanState = 'created';
  private listeners = new Set<(s: ScanState, from: ScanState) => void>();

  get state(): ScanState {
    return this.current;
  }

  can(event: ScanEvent): boolean {
    return transition(this.current, event) !== null;
  }

  /** Apply an event; returns false (and changes nothing) when it is not allowed. */
  send(event: ScanEvent): boolean {
    const next = transition(this.current, event);
    if (!next) return false;
    const from = this.current;
    this.current = next;
    for (const l of this.listeners) l(next, from);
    return true;
  }

  onChange(fn: (s: ScanState, from: ScanState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
