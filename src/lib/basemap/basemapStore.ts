/**
 * Registry of user-added base map tile folders + which one is active.
 *
 * `activeId === null` means "use the built-in default" (Documents/tiles, the
 * current vector basemap) — so a fresh install behaves exactly as before and
 * there is no regression. Selecting a registered source switches the basemap to
 * that folder (its `config.txt` decides how it is rendered).
 *
 * Persisted with zustand `persist` backed by Capacitor Preferences (durable on
 * Android across app restarts — plain localStorage is not; on Electron the
 * preferences shim writes to userData). This is what lets the last-selected base
 * map load on startup instead of falling back to the default. Paths are absolute
 * folder paths on Electron and SAF URIs on Android.
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { Preferences } from "@capacitor/preferences";
import {
  parseTilesConfig,
  type TilesConfig,
} from "@/lib/basemap/tileConfig";
import type { ElectronAPI } from "@/electron";

export interface BasemapSource {
  id: string;
  /** Display name (folder basename by default). */
  label: string;
  /** Absolute folder path (Electron) or SAF URI (Android). */
  path: string;
}

interface BasemapState {
  sources: BasemapSource[];
  /** id of the active source, or null for the built-in default (Documents/tiles). */
  activeId: string | null;
  /** Add (or re-select if the path already exists) and make active. */
  addSource: (label: string, path: string) => BasemapSource;
  removeSource: (id: string) => void;
  setActiveId: (id: string | null) => void;
  /** Replace the custom base map with a single folder and make it active. */
  selectFolder: (label: string, path: string) => BasemapSource;
  /** Clear the custom base map → back to the built-in default. */
  resetToDefault: () => void;
}

function makeId(): string {
  return `bm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Folder basename from an absolute path or SAF URI (best effort). */
export function basemapLabelFromPath(path: string): string {
  const clean = path.replace(/[\\/]+$/, "");
  const idx = Math.max(clean.lastIndexOf("/"), clean.lastIndexOf("\\"));
  const name = idx >= 0 ? clean.slice(idx + 1) : clean;
  try {
    return decodeURIComponent(name) || name;
  } catch {
    return name;
  }
}

export const useBasemapStore = create<BasemapState>()(
  persist(
    (set, get) => ({
      sources: [],
      activeId: null,
      addSource: (label, path) => {
        const existing = get().sources.find((s) => s.path === path);
        if (existing) {
          set({ activeId: existing.id });
          return existing;
        }
        const src: BasemapSource = {
          id: makeId(),
          label: label || basemapLabelFromPath(path),
          path,
        };
        set((st) => ({ sources: [...st.sources, src], activeId: src.id }));
        return src;
      },
      removeSource: (id) =>
        set((st) => ({
          sources: st.sources.filter((s) => s.id !== id),
          activeId: st.activeId === id ? null : st.activeId,
        })),
      setActiveId: (id) => set({ activeId: id }),
      selectFolder: (label, path) => {
        const src: BasemapSource = {
          id: makeId(),
          label: label || basemapLabelFromPath(path),
          path,
        };
        set({ sources: [src], activeId: src.id });
        return src;
      },
      resetToDefault: () => set({ sources: [], activeId: null }),
    }),
    {
      name: "basemap-sources-v1",
      // Durable across restarts on Android (localStorage isn't) and Electron.
      storage: createJSONStorage(() => ({
        getItem: (name) =>
          Preferences.get({ key: name }).then((r) => r.value),
        setItem: (name, value) =>
          Preferences.set({ key: name, value }),
        removeItem: (name) => Preferences.remove({ key: name }),
      })),
    },
  ),
);

/** The active source object, or null when on the built-in default. */
export function useActiveBasemapSource(): BasemapSource | null {
  return useBasemapStore(
    (s) => s.sources.find((x) => x.id === s.activeId) ?? null,
  );
}

// ---------------------------------------------------------------------------
// Reading a source's config.txt (Electron: direct file read; no serving needed)
// ---------------------------------------------------------------------------
function electronAPI(): ElectronAPI | undefined {
  return (window as Window & { electronAPI?: ElectronAPI }).electronAPI;
}

/** Read `<folder>/config.txt` for a source. Electron only; null elsewhere/absent. */
export async function readSourceConfigText(
  path: string,
): Promise<string | null> {
  const api = electronAPI();
  if (!api?.readFile) return null;
  const clean = path.replace(/[\\/]+$/, "");
  try {
    return await api.readFile(`${clean}/config.txt`);
  } catch {
    return null;
  }
}

/** Resolve a source's TilesConfig from its config.txt (Electron). */
export async function readSourceConfig(
  path: string,
): Promise<TilesConfig | null> {
  const text = await readSourceConfigText(path);
  return text ? parseTilesConfig(text) : null;
}
