import { create } from "zustand";
import { persist } from "zustand/middleware";

interface UdpSymbolsState {
  nodeSymbols: Record<string, string>; // Key: "layerId:userId", Value: symbol name
  setNodeSymbol: (layerId: string, userId: number, symbol: string) => void;
  getNodeSymbol: (layerId: string, userId: number) => string | undefined;
  clearNodeSymbol: (layerId: string, userId: number) => void;
}

export const useUdpSymbolsStore = create<UdpSymbolsState>()(
  persist(
    (set, get) => ({
      nodeSymbols: {},
      setNodeSymbol: (layerId: string, userId: number, symbol: string) =>
        set((state) => {
          const key = `${layerId}:${userId}`;
          const newSymbols = { ...state.nodeSymbols };
          if (symbol === "") {
            // Remove symbol if setting to empty string (default)
            delete newSymbols[key];
          } else {
            newSymbols[key] = symbol;
          }
          return { nodeSymbols: newSymbols };
        }),
      getNodeSymbol: (layerId: string, userId: number) => {
        const key = `${layerId}:${userId}`;
        return get().nodeSymbols[key];
      },
      clearNodeSymbol: (layerId: string, userId: number) =>
        set((state) => {
          const key = `${layerId}:${userId}`;
          const newSymbols = { ...state.nodeSymbols };
          delete newSymbols[key];
          return { nodeSymbols: newSymbols };
        }),
    }),
    {
      name: "udp-symbols-storage", // localStorage key
    }
  )
);
