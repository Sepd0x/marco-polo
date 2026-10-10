import { useEffect, useId, useRef, useState } from 'react';
import { useStore } from '../state/store.js';
import { clearTileCache } from '../scan/tileSource.js';
import { currentTheme, setTheme, type Theme } from '../lib/theme.js';
import { SourcePicker } from './MapChrome.js';
import { IconClose } from './icons.js';

function Toggle({ label, hint, on, onChange }: { label: string; hint?: string; on: boolean; onChange: (v: boolean) => void }) {
  const id = useId();
  return (
    <div className="set-row">
      <label htmlFor={id}>
        {label}
        {hint && <span className="opt-sub">{hint}</span>}
      </label>
      <input id={id} type="checkbox" role="switch" className="switch" checked={on} onChange={(e) => onChange(e.target.checked)} />
    </div>
  );
}

export function ThemeControl() {
  const [theme, set] = useState<Theme>(currentTheme);
  const pick = (t: Theme) => {
    setTheme(t);
    set(t);
  };
  return (
    <div className="set-row">
      <span id="theme-l">Theme</span>
      <span className="seg" role="group" aria-labelledby="theme-l">
        <button aria-pressed={theme === 'light'} onClick={() => pick('light')}>
          Light
        </button>
        <button aria-pressed={theme === 'dark'} onClick={() => pick('dark')}>
          Dark
        </button>
      </span>
    </div>
  );
}

/** Settings as a modal dialog: Esc or the close button returns focus to where it was. */
export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const settings = useStore((s) => s.settings);
  const update = useStore((s) => s.updateSettings);
  const ref = useRef<HTMLDivElement>(null);
  const rateId = useId();
  const [cleared, setCleared] = useState(false);

  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('button, input')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
      if (e.key === 'Tab' && ref.current) {
        const items = [...ref.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)')];
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      back?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="backdrop" onClick={onClose}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-h"
        ref={ref}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-h">
          <h2 id="settings-h">Settings</h2>
          <button className="icon-btn" aria-label="Close settings" onClick={onClose}>
            <IconClose />
          </button>
        </div>
        <div className="dialog-body">
          <SourcePicker />
          <div className="set-row">
            <label htmlFor={rateId}>
              Speed
              <span className="opt-sub">Each source has its own limit; the lower one applies.</span>
            </label>
            <span className="rate">
              <input
                id={rateId}
                type="range"
                min={1}
                max={10}
                step={1}
                value={settings.ratePerSec}
                onChange={(e) => update({ ratePerSec: Number(e.target.value) })}
                style={{ ['--fill' as string]: `${((settings.ratePerSec - 1) / 9) * 100}%` }}
              />
              <output htmlFor={rateId}>{settings.ratePerSec} tiles/s</output>
            </span>
          </div>
          <Toggle
            label="Follow the scan"
            hint="The map moves to the tile being scanned."
            on={settings.follow}
            onChange={(v) => update({ follow: v })}
          />
          <Toggle label="Street names" on={settings.labels} onChange={(v) => update({ labels: v })} />
          <Toggle label="Include hot tubs" on={settings.showHotTubs} onChange={(v) => update({ showHotTubs: v })} />
          <ThemeControl />
          <div className="set-row">
            <span>
              Saved imagery
              <span className="opt-sub">Open imagery is kept on this device to make rescans faster.</span>
            </span>
            <button
              className="btn small"
              onClick={async () => {
                await clearTileCache();
                setCleared(true);
              }}
            >
              {cleared ? 'Cleared' : 'Clear'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
