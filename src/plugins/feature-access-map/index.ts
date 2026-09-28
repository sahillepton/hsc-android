import { Capacitor, registerPlugin } from "@capacitor/core";

/**
 * Snapshot of native {@code observeFeatureMap}: IP → granted feature ids for that contact.
 * Matches client FeaturePermission JSON shape (keys = node IPs, values = Long ids).
 *
 * Feature ids (same as GIS tooltip actions):
 * - 1 → Audio call + Video call
 * - 2 → FTP
 * - 4 → SMS / Message
 *
 * Integrated MCSA app: register native plugin (see kt-msca-plugins/FeatureAccessMapPlugin.kt).
 * Standalone GIS APK: stub returns an empty map.
 */
export interface FeatureAccessMapPlugin {
  getFeatureMap(): Promise<{ map: Record<string, number[]> }>;
}

function isAndroidNative(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}

function createStub(): FeatureAccessMapPlugin {
  return {
    async getFeatureMap() {
      return { map: {} };
    },
  };
}

export const FeatureAccessMap: FeatureAccessMapPlugin = isAndroidNative()
  ? registerPlugin<FeatureAccessMapPlugin>("FeatureAccessMap")
  : createStub();
