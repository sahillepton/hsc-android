/**
 * Shim for @capacitor/core — desktop replacement.
 * registerPlugin returns a Proxy that logs warnings for any method call.
 */

export function registerPlugin<T>(name: string): T {
  return new Proxy({} as any, {
    get(_target, prop) {
      if (prop === "then") return undefined; // prevent Promise-like behavior
      if (typeof prop === "symbol") return undefined;
      return (...args: any[]) => {
        console.warn(`[CapacitorShim] Plugin "${name}.${String(prop)}" called on desktop — not implemented yet.`, args);
        return Promise.resolve({});
      };
    },
  }) as T;
}

export const Capacitor = {
  isNativePlatform: () => !!(window as any).electronAPI,
  getPlatform: () => ((window as any).electronAPI ? "electron" : "web") as string,
  convertFileSrc: (path: string) => {
    // On desktop, local file paths can be loaded with file:// protocol
    if (path.startsWith("/")) return `file://${path}`;
    if (path.match(/^[A-Z]:\\/i)) return `file:///${path.replace(/\\/g, "/")}`;
    return path;
  },
};

export type PluginListenerHandle = { remove: () => void };

