import { create } from "zustand";
import { persist } from "zustand/middleware";

interface UdpSymbolsState {
  layerSymbols: Record<string, string>; // Key: layerId, Value: symbol name
  setLayerSymbol: (layerId: string, symbol: string) => void;
  getLayerSymbol: (layerId: string) => string | undefined;
  clearLayerSymbol: (layerId: string) => void;
  // Legacy support for node-level symbols (for backward compatibility)
  nodeSymbols: Record<string, string>; // Key: "layerId:userId", Value: symbol name
  setNodeSymbol: (layerId: string, userId: number, symbol: string) => void;
  getNodeSymbol: (layerId: string, userId: number) => string | undefined;
  clearNodeSymbol: (layerId: string, userId: number) => void;
}

export const useUdpSymbolsStore = create<UdpSymbolsState>()(
  persist(
    (set, get) => ({
      layerSymbols: {},
      setLayerSymbol: (layerId: string, symbol: string) =>
        set((state) => {
          const newSymbols = { ...state.layerSymbols };
          if (symbol === "") {
            // Remove symbol if setting to empty string (default)
            delete newSymbols[layerId];
          } else {
            newSymbols[layerId] = symbol;
          }
          return { layerSymbols: newSymbols };
        }),
      getLayerSymbol: (layerId: string) => {
        return get().layerSymbols[layerId];
      },
      clearLayerSymbol: (layerId: string) =>
        set((state) => {
          const newSymbols = { ...state.layerSymbols };
          delete newSymbols[layerId];
          return { layerSymbols: newSymbols };
        }),
      // Legacy node-level support (kept for backward compatibility)
      nodeSymbols: {},
      setNodeSymbol: (layerId: string, userId: number, symbol: string) =>
        set((state) => {
          const key = `${layerId}:${userId}`;
          const newSymbols = { ...state.nodeSymbols };
          if (symbol === "") {
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
