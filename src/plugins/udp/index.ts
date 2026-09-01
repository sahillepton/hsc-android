import { registerPlugin } from "@capacitor/core";

export interface UdpPlugin {
  create(options?: Record<string, unknown>): Promise<void>;
  send(options: { data: string }): Promise<void>;
  closeAllSockets(): Promise<void>;
  addListener(
    eventName: "udpMessage",
    listenerFunc: (event: { buffer: ArrayBuffer | Uint8Array }) => void
  ): Promise<{ remove: () => void }>;
}

// ── Platform detection ──
function isElectron(): boolean {
  return typeof window !== "undefined" && !!(window as any).electronAPI;
}

// ── Electron desktop implementation ──
function createDesktopPlugin(): UdpPlugin {
  const api = () => (window as any).electronAPI;
  return {
    async create(_options?: Record<string, unknown>) {
      await api().udpCreate();
    },
    async send(options: { data: string }) {
      await api().udpSend(options.data);
    },
    async closeAllSockets() {
      await api().udpCloseAll();
    },
    async addListener(
      _eventName: "udpMessage",
      listenerFunc: (event: { buffer: ArrayBuffer | Uint8Array }) => void
    ) {
      // The main process pushes "udp:message" events via webContents.send().
      // The preload exposes udpOnMessage which uses ipcRenderer.on().
      const removeListener = api().udpOnMessage(
        (data: { buffer: Uint8Array; byteLength: number }) => {
          // Electron path already receives Uint8Array; pass through without copy.
          listenerFunc({ buffer: data.buffer });
        }
      );

      return {
        remove: () => {
          if (typeof removeListener === "function") {
            removeListener();
          }
        },
      };
    },
  };
}

// ── Export: Electron uses IPC, Android uses Capacitor native plugin ──
export const Udp: UdpPlugin = isElectron()
  ? createDesktopPlugin()
  : registerPlugin<UdpPlugin>("Udp");
