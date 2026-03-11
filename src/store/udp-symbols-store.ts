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
  // Group-level symbols for topology groups
  groupSymbols: Record<string, string>; // Key: "topology-group-{groupId}", Value: symbol name
  setGroupSymbol: (groupId: string, symbol: string) => void;
  getGroupSymbol: (groupId: string) => string | undefined;
  clearGroupSymbol: (groupId: string) => void;
  // Mother node symbol
  motherNodeSymbol: string; // Default: "mother-fighter"
  setMotherNodeSymbol: (symbol: string) => void;
  // SNR gradient colors [low, mid, high] as hex strings
  snrColors: [string, string, string]; // Default: ["#FF0000", "#FFFF00", "#00FF00"]
  setSnrColors: (colors: [string, string, string]) => void;
  // SNR line widths [low, mid, high] in pixels
  snrLineWidths: [number, number, number]; // Default: [1, 3, 5]
  setSnrLineWidths: (widths: [number, number, number]) => void;
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
      // Group-level symbols
      groupSymbols: {},
      setGroupSymbol: (groupId: string, symbol: string) =>
        set((state) => {
          const key = `topology-group-${groupId}`;
          const newSymbols = { ...state.groupSymbols };
          if (symbol === "") {
            delete newSymbols[key];
          } else {
            newSymbols[key] = symbol;
          }
          return { groupSymbols: newSymbols };
        }),
      getGroupSymbol: (groupId: string) => {
        const key = `topology-group-${groupId}`;
        return get().groupSymbols[key];
      },
      clearGroupSymbol: (groupId: string) =>
        set((state) => {
          const key = `topology-group-${groupId}`;
          const newSymbols = { ...state.groupSymbols };
          delete newSymbols[key];
          return { groupSymbols: newSymbols };
        }),
      // Mother node symbol
      motherNodeSymbol: "mother-fighter",
      setMotherNodeSymbol: (symbol: string) =>
        set({ motherNodeSymbol: symbol || "mother-fighter" }),
      // SNR gradient colors
      snrColors: ["#FF0000", "#FFFF00", "#00FF00"] as [string, string, string],
      setSnrColors: (colors: [string, string, string]) =>
        set({ snrColors: colors }),
      // SNR line widths
      snrLineWidths: [1, 3, 5] as [number, number, number],
      setSnrLineWidths: (widths: [number, number, number]) =>
        set({ snrLineWidths: widths }),
    }),
    {
      name: "udp-symbols-storage", // localStorage key
    }
  )
);
