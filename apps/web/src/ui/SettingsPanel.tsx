import { useState } from 'react';
import { useStore } from '../state/store.js';
import { clearTileCache } from '../scan/tileSource.js';
import { ACCENT_PRESETS, parseHex } from '../lib/theme.js';
import { BUILD_COMMIT } from '../lib/updates.js';

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const settings = useStore((s) => s.settings);
  const phase = useStore((s) => s.phase);
  const update = useStore((s) => s.updateSettings);
  const scanning = phase === 'scanning' || phase === 'paused';
  const [customHex, setCustomHex] = useState('');

  return (
    <div className="settings-pop panel fade-up">
      <div className="row">
        <span className="label">Scan zoom</span>
        <select
          className="field"
          style={{ width: 130 }}
          value={settings.zoom}
          disabled={scanning}
          onChange={(e) => update({ zoom: Number(e.target.value) })}
        >
          <option value={18}>z18 · ~0.6 m/px</option>
          <option value={19}>z19 · ~0.3 m/px</option>
        </select>
      </div>
      <div className="row">
        <span className="label">Traversal</span>
        <select
          className="field"
          style={{ width: 130 }}
          value={settings.order}
          disabled={scanning}
          onChange={(e) => update({ order: e.target.value as 'serpentine' | 'spiral' })}
        >
          <option value="serpentine">serpentine</option>
          <option value="spiral">spiral</option>
        </select>
      </div>
      <div className="row">
        <span className="label">Tile rate</span>
        <input
          type="range"
          min={1}
          max={10}
          step={1}
          value={settings.ratePerSec}
          onChange={(e) => update({ ratePerSec: Number(e.target.value) })}
        />
        <span className="val">{settings.ratePerSec}/s</span>
      </div>
      <div className="row">
        <span className="label">Camera follow</span>
        <button
          className={`toggle ${settings.follow ? 'on' : ''}`}
          onClick={() => update({ follow: !settings.follow })}
        />
      </div>
      <div className="row">
        <span className="label">Place labels</span>
        <button
          className={`toggle ${settings.labels ? 'on' : ''}`}
          onClick={() => update({ labels: !settings.labels })}
        />
      </div>
      <div className="row">
        <span className="label">Accent</span>
        <div className="swatches">
          {ACCENT_PRESETS.map((p) => (
            <button
              key={p.hex}
              className={`swatch ${settings.accent.toLowerCase() === p.hex ? 'on' : ''}`}
              style={{ background: p.hex }}
              title={p.name}
              onClick={() => update({ accent: p.hex })}
            />
          ))}
        </div>
      </div>
      <div className="row">
        <span className="label">Custom hex</span>
        <input
          className="field"
          style={{ width: 110 }}
          placeholder="#35e0ff"
          value={customHex}
          onChange={(e) => {
            setCustomHex(e.target.value);
            const rgb = parseHex(e.target.value);
            if (rgb) update({ accent: e.target.value.startsWith('#') ? e.target.value : `#${e.target.value}` });
          }}
        />
      </div>
      <ProviderPicker scanning={scanning} />
      <div className="row">
        <button
          className="btn"
          style={{ flex: 1, justifyContent: 'center' }}
          onClick={() => void clearTileCache()}
          title="Clear locally cached imagery tiles"
        >
          clear tile cache
        </button>
        <button className="btn" style={{ flex: 1, justifyContent: 'center' }} onClick={onClose}>
          close
        </button>
      </div>
      <div className="build-line">
        build {BUILD_COMMIT === 'dev' ? 'dev' : BUILD_COMMIT.slice(0, 7)} · updates arrive automatically
        from GitHub
      </div>
    </div>
  );
}

type PresetId = 'esri' | 'maptiler' | 'mapbox' | 'custom';

function presetOf(template: string): PresetId {
  if (!template.trim()) return 'esri';
  if (template.includes('api.maptiler.com')) return 'maptiler';
  if (template.includes('api.mapbox.com')) return 'mapbox';
  return 'custom';
}

const KEYED: Record<'maptiler' | 'mapbox', { keyLabel: string; make: (key: string) => string }> = {
  maptiler: {
    keyLabel: 'MapTiler key',
    make: (k) => `https://api.maptiler.com/tiles/satellite-v2/{z}/{x}/{y}.jpg?key=${k}`,
  },
  mapbox: {
    keyLabel: 'Mapbox token',
    make: (k) => `https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}.jpg90?access_token=${k}`,
  },
};

/**
 * Imagery source picker. Default is keyless Esri World Imagery; MapTiler and
 * Mapbox slots take the user's own API key (stored locally, embedded in the
 * tile template); anything else fits the custom XYZ slot. Check the terms of
 * whichever provider you point the scanner at — see docs/IMAGERY.md.
 */
function ProviderPicker({ scanning }: { scanning: boolean }) {
  const settings = useStore((s) => s.settings);
  const update = useStore((s) => s.updateSettings);
  const [preset, setPreset] = useState<PresetId>(() => presetOf(settings.providerTemplate));

  return (
    <>
      <div className="row">
        <span className="label">Imagery</span>
        <select
          className="field"
          style={{ width: 160 }}
          value={preset}
          disabled={scanning}
          onChange={(e) => {
            const p = e.target.value as PresetId;
            setPreset(p);
            if (p === 'esri') update({ providerTemplate: '' });
          }}
        >
          <option value="esri">Esri World Imagery</option>
          <option value="maptiler">MapTiler satellite · key</option>
          <option value="mapbox">Mapbox satellite · key</option>
          <option value="custom">Custom XYZ</option>
        </select>
      </div>
      {(preset === 'maptiler' || preset === 'mapbox') && (
        <input
          className="field"
          type="password"
          placeholder={`${KEYED[preset].keyLabel} — stays on this device`}
          disabled={scanning}
          defaultValue={extractKey(settings.providerTemplate)}
          onChange={(e) => {
            const k = e.target.value.trim();
            update({ providerTemplate: k ? KEYED[preset].make(k) : '' });
          }}
        />
      )}
      {preset === 'custom' && (
        <input
          className="field"
          placeholder="https://…/{z}/{x}/{y}.jpg"
          disabled={scanning}
          value={settings.providerTemplate}
          onChange={(e) => update({ providerTemplate: e.target.value })}
        />
      )}
    </>
  );
}

function extractKey(template: string): string {
  const m = /(?:key|access_token)=([^&]+)/.exec(template);
  return m ? m[1] : '';
}
