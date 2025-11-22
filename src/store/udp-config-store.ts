import { create } from "zustand";
import { persist } from "zustand/middleware";

interface UdpConfigState {
  host: string;
  port: number;
  setConfig: (host: string, port: number) => void;
}

export const useUdpConfigStore = create<UdpConfigState>()(
  persist(
    (set) => ({
      host: "127.0.0.1",
      port: 5005,
      setConfig: (host: string, port: number) => set({ host, port }),
    }),
    {
      name: "udp-config-storage",
    }
  )
);
