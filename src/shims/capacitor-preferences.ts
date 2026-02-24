/**
 * Shim for @capacitor/preferences — uses window.electronAPI IPC.
 */

function api() {
  return (window as any).electronAPI;
}

export const Preferences = {
  async get(options: { key: string }) {
    const value = await api().getPreference(options.key);
    return { value };
  },

  async set(options: { key: string; value: string }) {
    await api().setPreference(options.key, options.value);
  },

  async remove(options: { key: string }) {
    await api().removePreference(options.key);
  },

  async keys() {
    // Not commonly used, return empty for now
    return { keys: [] as string[] };
  },

  async clear() {
    console.warn("[PreferencesShim] clear() not implemented");
  },
};

