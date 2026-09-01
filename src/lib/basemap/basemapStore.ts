/**
 * Registry of user-added base map tile folders + which one is active.
 *
 * `activeId === null` means "use the built-in default" (Documents/tiles, the
 * current vector basemap) — so a fresh install behaves exactly as before and
 * there is no regression. Selecting a registered source switches the basemap to
 * that folder; how it is rendered comes from the projection/format the user
 * picks in the settings dialog (stored on the source) plus what the tile server
 * reports about the folder — config.txt is no longer read.
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
import type { Projection } from "@/lib/basemap/tileConfig";

export interface BasemapSource {
  id: string;
  /** Display name (folder basename by default). */
  label: string;
  /** Absolute folder path (Electron) or SAF URI (Android). */
  path: string;
  /**
   * The user's choice from the settings dialog, replacing config.txt.
   *
   * Optional on purpose: sources saved before this existed have neither, and
   * `undefined` is what the UI reads as "not configured yet" so it can prompt
   * once instead of guessing silently. Everything else a tile set needs is
   * derived — the zoom range from the server's /basemap/__levels listing, the
   * grid by probing, tileSize/scheme from defaults.
   */
  projection?: Projection;
  format?: string;
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
  /**
   * Whether the Map Tiles setup has been shown once already.
   *
   * Persisted so the first-launch prompt is exactly that — a first launch. The
   * built-in default basemap stays perfectly usable, so dismissing the prompt
   * must not bring it back on every start.
   */
  promptedForFolder: boolean;
  markPromptedForFolder: () => void;
  /** Store the projection/format the user picked in step 2 of the dialog. */
  setSourceConfig: (
    id: string,
    cfg: { projection: Projection; format: string },
  ) => void;
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
      promptedForFolder: false,
      markPromptedForFolder: () => set({ promptedForFolder: true }),
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
      setSourceConfig: (id, cfg) =>
        set((st) => ({
          sources: st.sources.map((s) =>
            s.id === id
              ? { ...s, projection: cfg.projection, format: cfg.format }
              : s,
          ),
        })),
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
