import { create } from 'zustand';
import type { SortKey } from './model.js';

/** Interface-only state: nothing here reaches the scan or the map. */
interface UiState {
  sort: SortKey;
  settingsOpen: boolean;
  sourcePickerOpen: boolean;
  /** Phone: the credits under the map shown in full instead of on one line. */
  attribOpen: boolean;
  setSort(sort: SortKey): void;
  setSettingsOpen(open: boolean): void;
  setSourcePickerOpen(open: boolean): void;
  setAttribOpen(open: boolean): void;
}

export const useUi = create<UiState>()((set) => ({
  sort: 'largest',
  settingsOpen: false,
  sourcePickerOpen: false,
  attribOpen: false,
  setSort: (sort) => set({ sort }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen, sourcePickerOpen: false }),
  setSourcePickerOpen: (sourcePickerOpen) => set({ sourcePickerOpen }),
  setAttribOpen: (attribOpen) => set({ attribOpen }),
}));
