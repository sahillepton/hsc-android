import { create } from "zustand";

interface UdpLayerData {
  targets: any[];
  networkMembers: any[];
  networkMemberPositions: Map<number, any>;
  networkMemberMetadata: Map<number, any>;
  engagingMembers: any[];
  threats: any[];
  geoMessages: any[];
  topology: {
    nodes: Map<
      number,
      {
        id: number;
        lat: number;
        long: number;
        neighbors: Array<{ id: number; snr: number }>;
      }
    >;
    connections: Map<string, number>; // Key: "nodeId1_nodeId2" (smaller first), Value: SNR
  };
}

interface UdpDataState {
  udpData: UdpLayerData;
  connectionError: string | null;
  noDataWarning: string | null;
  isConnected: boolean;
  setUdpData: (
    data: UdpLayerData | ((prev: UdpLayerData) => UdpLayerData)
  ) => void;
  setConnectionError: (error: string | null) => void;
  setNoDataWarning: (warning: string | null) => void;
  setIsConnected: (connected: boolean) => void;
  reset: () => void;
  resetConnectionState: () => void;
}

export const useUdpDataStore = create<UdpDataState>((set) => ({
  udpData: {
    targets: [],
    networkMembers: [],
    networkMemberPositions: new Map(),
    networkMemberMetadata: new Map(),
    engagingMembers: [],
    threats: [],
    geoMessages: [],
    topology: {
      nodes: new Map(),
      connections: new Map(),
    },
  },
  connectionError: null,
  noDataWarning: null,
  isConnected: false,
  setUdpData: (data) =>
    set((state) => {
      const newData = typeof data === "function" ? data(state.udpData) : data;
      // Always return a new object reference to ensure Zustand detects changes
      return {
        udpData: {
          ...newData,
          networkMemberPositions: new Map(newData.networkMemberPositions),
          networkMemberMetadata: new Map(newData.networkMemberMetadata),
          topology: {
            nodes: new Map(newData.topology?.nodes || []),
            connections: new Map(newData.topology?.connections || []),
          },
        },
      };
    }),
  setConnectionError: (error) => set({ connectionError: error }),
  setNoDataWarning: (warning) => set({ noDataWarning: warning }),
  setIsConnected: (connected) => set({ isConnected: connected }),
  reset: () =>
    set({
      udpData: {
        targets: [],
        networkMembers: [],
        networkMemberPositions: new Map(),
        networkMemberMetadata: new Map(),
        engagingMembers: [],
        threats: [],
        geoMessages: [],
        topology: {
          nodes: new Map(),
          connections: new Map(),
        },
      },
      connectionError: null,
      noDataWarning: null,
      isConnected: false,
    }),
  resetConnectionState: () =>
    set({
      connectionError: null,
      noDataWarning: null,
      isConnected: false,
    }),
}));
