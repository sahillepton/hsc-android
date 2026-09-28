import { create } from "zustand";
import { FeatureAccessMap } from "@/plugins/feature-access-map";
import { normalizeFeatureAccessMap } from "@/lib/topology-feature-actions";

export interface FeatureAccessMapState {
  /** IP → feature id list from native observeFeatureMap snapshot */
  map: Record<string, number[]>;
  lastError: string | null;
  /** True while at least one refreshFromNative request is in flight */
  featureMapLoading: boolean;
  refreshFromNative: () => Promise<void>;
}

export const useFeatureAccessMapStore = create<FeatureAccessMapState>((set) => {
  let pending = 0;
  return {
    map: {},
    lastError: null,
    featureMapLoading: false,
    refreshFromNative: async () => {
      pending += 1;
      set({ featureMapLoading: true });
      try {
        const res = await FeatureAccessMap.getFeatureMap();
        const map = normalizeFeatureAccessMap(res?.map ?? res);
        set({ map, lastError: null });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        set({ lastError: msg });
      } finally {
        pending -= 1;
        set({ featureMapLoading: pending > 0 });
      }
    },
  };
});
