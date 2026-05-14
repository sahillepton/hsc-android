/** Feature ids from native FeaturePermission / FeatureMapping (Long on wire). */
export const TOPOLOGY_FEATURE_CALL_VIDEO = 1;
export const TOPOLOGY_FEATURE_FTP = 2;
export const TOPOLOGY_FEATURE_SMS = 4;

export type TopologyTooltipActions = {
  video: boolean;
  call: boolean;
  ftp: boolean;
  message: boolean;
};

const NONE: TopologyTooltipActions = {
  video: false,
  call: false,
  ftp: false,
  message: false,
};

/**
 * Decide which topology tooltip buttons to show from IP-keyed feature map.
 * - Missing key → no buttons
 * - Empty list → no buttons
 * - 1 → video + audio call; 2 → FTP; 4 → message (SMS)
 */
export function getTopologyTooltipActions(
  ip: string,
  map: Record<string, number[]>,
): TopologyTooltipActions {
  if (!ip || ip === "Unknown") return NONE;
  const list = map[ip];
  if (!Array.isArray(list) || list.length === 0) return NONE;
  const idSet = new Set(list.map((n) => Number(n)));
  return {
    video: idSet.has(TOPOLOGY_FEATURE_CALL_VIDEO),
    call: idSet.has(TOPOLOGY_FEATURE_CALL_VIDEO),
    ftp: idSet.has(TOPOLOGY_FEATURE_FTP),
    message: idSet.has(TOPOLOGY_FEATURE_SMS),
  };
}

export function hasAnyTopologyTooltipAction(a: TopologyTooltipActions): boolean {
  return a.video || a.call || a.ftp || a.message;
}

function coerceNumberArray(ids: unknown): number[] {
  if (Array.isArray(ids)) {
    return ids.map((x) => Number(x)).filter((n) => !Number.isNaN(n));
  }
  if (ids != null && typeof ids === "object") {
    return Object.values(ids as Record<string, unknown>)
      .map((x) => Number(x))
      .filter((n) => !Number.isNaN(n));
  }
  return [];
}

/** Normalize Capacitor JSObject map → plain Record (nested values may be arrays). */
export function normalizeFeatureAccessMap(raw: unknown): Record<string, number[]> {
  if (!raw || typeof raw !== "object") return {};
  const obj = raw as Record<string, unknown>;
  const inner = obj.map ?? obj;
  if (!inner || typeof inner !== "object") return {};
  const out: Record<string, number[]> = {};
  for (const [ip, ids] of Object.entries(inner)) {
    const nums = coerceNumberArray(ids);
    if (nums.length > 0) out[ip] = nums;
  }
  return out;
}
