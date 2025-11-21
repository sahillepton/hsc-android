import { create } from "zustand";
import { persist } from "zustand/middleware";

interface UdpConfigState {
  wsHost: string;
  wsPort: number;
  setConfig: (host: string, port: number) => void;
  getWsUrl: () => string;
}

export const useUdpConfigStore = create<UdpConfigState>()(
  persist(
    (set, get) => ({
      wsHost: "localhost",
      wsPort: 8080,
      setConfig: (host: string, port: number) =>
        set({ wsHost: host, wsPort: port }),
      getWsUrl: () => {
        const { wsHost, wsPort } = get();
        return `ws://${wsHost}:${wsPort}`;
      },
    }),
    {
      name: "udp-config-storage",
    }
  )
);
