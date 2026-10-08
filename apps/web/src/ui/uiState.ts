import { create } from 'zustand';
import type { SortKey } from './model.js';

/** Interface-only state: nothing here reaches the scan or the map. */
interface UiState {
  sort: SortKey;
  settingsOpen: boolean;
  sourcePickerOpen: boolean;
  /** Phone: the sheet shows the whole list instead of the summary or the pool card. */
  sheetList: boolean;
  setSort(sort: SortKey): void;
  setSettingsOpen(open: boolean): void;
  setSourcePickerOpen(open: boolean): void;
  setSheetList(open: boolean): void;
}

export const useUi = create<UiState>()((set) => ({
  sort: 'largest',
  settingsOpen: false,
  sourcePickerOpen: false,
  sheetList: false,
  setSort: (sort) => set({ sort }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen, sourcePickerOpen: false }),
  setSourcePickerOpen: (sourcePickerOpen) => set({ sourcePickerOpen }),
  setSheetList: (sheetList) => set({ sheetList }),
}));
