import {
  formatArea,
  formatDistance,
  getDistance,
  formatLabel,
  calculateIgrs,
} from "@/lib/utils";
import {
  TOOLTIP_DEFAULT_ATTR_LIMIT,
  TOPOLOGY_ALTITUDE_RESOLUTION_M,
} from "@/lib/constants";
import {
  azimuthDisplayAngle,
  computePolygonPerimeterMeters,
  computePolygonAreaMeters,
  isStoreLayerPickObject,
} from "@/lib/layers";
import {
  useHoverInfo,
  useLayers,
  useIgrsPreference,
  useUserLocation,
} from "@/store/layers-store";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Video,
  Upload,
  MessageSquare,
  PhoneCall,
  MonitorPlay,
} from "lucide-react";
import {
  TooltipBox,
  TooltipHeading,
  TooltipProperties,
  TooltipDivider,
} from "@/lib/tooltip-components";
import MemberAction from "@/plugins/member-action";
import { Capacitor } from "@capacitor/core";
import { useTileSampler } from "@/lib/tiling/hover";
import { useFeatureAccessMapStore } from "@/store/feature-access-map-store";
import type { FeatureAccessMapState } from "@/store/feature-access-map-store";
import {
  getTopologyTooltipActions,
  hasAnyTopologyTooltipAction,
} from "@/lib/topology-feature-actions";
import { useUdpDataStore } from "@/store/udp-data-store";
import {
  isShortestRouteLayer,
  SHORTEST_ROUTE_INTERNAL_PROPS,
} from "@/lib/route-layer";
import {
  RASTER_TOOLTIP_ATTRIBUTES,
  isRasterTooltipAttrShown,
} from "@/lib/raster-tooltip-attributes";

const SHORTEST_ROUTE_TOOLTIP_HIDDEN_PROPS = new Set<string>(
  SHORTEST_ROUTE_INTERNAL_PROPS,
);

/**
 * Topology → native `globalId`: IPv4 from `object.ip`, or `"Unknown"` if missing/invalid.
 */
function topologyMemberActionGlobalId(obj: Record<string, unknown>): string {
  const raw = obj.ip;
  if (typeof raw !== "string") return "Unknown";
  const t = raw.trim();
  if (t === "" || t === "0.0.0.0") return "Unknown";
  return t;
}

/** Merge live UDP topology coords into the stale pick snapshot from tap/hover. */
function liveTopologyTooltipObject(
  object: unknown,
  topologyNodes: ReturnType<
    typeof useUdpDataStore.getState
  >["udpData"]["topology"]["nodes"],
): Record<string, unknown> | null {
  if (!object || typeof object !== "object") return null;
  const snapshot = object as Record<string, unknown>;
  const globalId = snapshot.globalId as number | undefined;
  if (globalId === undefined) return snapshot;
  const live = topologyNodes.get(globalId);
  if (!live) return snapshot;
  return {
    ...snapshot,
    globalId: live.id,
    ip: live.ip,
    longitude: live.long,
    latitude: live.lat,
    altitude: live.altitude,
  };
}

type LngLat = [number, number];

/**
 * Closest point to `p` on the segment a→b, in lng/lat space.
 *
 * Plain 2D projection onto the segment. Degrees are not isotropic (a degree of
 * longitude is shorter than a degree of latitude away from the equator), so this
 * is not the true geodesic nearest point — but the input is only ever a few pixels
 * off the line, over which the distortion is far below one pixel. Using degrees
 * directly keeps it exact in the space the anchor is actually projected from.
 */
function closestPointOnSegment(p: LngLat, a: LngLat, b: LngLat): LngLat {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return [a[0], a[1]];
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t)); // clamp to the segment, not the infinite line
  return [a[0] + t * dx, a[1] + t * dy];
}

/** True when every element looks like a [lng, lat] pair. */
function isCoordPath(v: unknown): v is ReadonlyArray<ReadonlyArray<number>> {
  return (
    Array.isArray(v) &&
    v.length > 0 &&
    Array.isArray(v[0]) &&
    typeof (v[0] as unknown[])[0] === "number"
  );
}

const isMeaningfulPropertyValue = (value: unknown): boolean => {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return (
      normalized !== "" &&
      normalized !== "null" &&
      normalized !== "undefined" &&
      normalized !== "nan"
    );
  }
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value as object).length > 0;
  return true;
};

const formatOsmOtherTags = (raw: string): string => {
  if (!raw) return "";
  const normalized = raw.replace(/\\"/g, '"').trim();
  const pairRegex = /"((?:\\.|[^"\\])*)"=>"((?:\\.|[^"\\])*)"/g;
  const pairs: string[] = [];

  for (const match of normalized.matchAll(pairRegex)) {
    const key = match[1].replace(/\\"/g, '"').trim();
    const value = match[2].replace(/\\"/g, '"').trim();
    if (!key) continue;
    pairs.push(value ? `${key}=${value}` : key);
  }

  if (!pairs.length) return normalized;

  const maxPairs = 6;
  const visible = pairs.slice(0, maxPairs);
  if (pairs.length > maxPairs) {
    visible.push(`+${pairs.length - maxPairs} more`);
  }
  return visible.join("; ");
};

const formatTooltipValue = (key: string, value: unknown): string => {
  if (typeof value === "string") {
    if (key.toLowerCase() === "other_tags") {
      return formatOsmOtherTags(value);
    }
    return value.trim();
  }
  if (typeof value === "number") {
    // Cap displayed precision at 6 decimals to match the coordinate readouts —
    // feature attributes like `latitude`/`longitude` otherwise print ~14 digits.
    // toFixed→Number trims trailing zeros, so integers and short decimals are
    // unchanged (16787941 stays 16787941, 86.21 stays 86.21).
    return Number.isFinite(value)
      ? String(Number(value.toFixed(6)))
      : String(value);
  }
  if (typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value) || (value && typeof value === "object")) {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
};

const formatAttributeLabel = (key: string): string => {
  if (!key) return key;
  const withSpaces = key
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/-/g, " ")
    .trim();
  return withSpaces
    .split(/\s+/)
    .map((word) =>
      word ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : word,
    )
    .join(" ");
};

const Tooltip = () => {
  const { hoverInfo } = useHoverInfo();
  const { layers } = useLayers();
  const useIgrs = useIgrsPreference();
  const { showUserLocation, userLocation } = useUserLocation();
  const [coarsePointer, setCoarsePointer] = useState(
    () =>
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(pointer: coarse)").matches,
  );
  useEffect(() => {
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    )
      return;
    const mq = window.matchMedia("(pointer: coarse)");
    const apply = () => setCoarsePointer(mq.matches);
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  const isDesktopBuild = !!(window as any).electronAPI;
  const [tooltipPosition, setTooltipPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [mapZoom, setMapZoom] = useState<number | null>(null);
  const lastTooltipPositionRef = useRef<{ x: number; y: number } | null>(null);
  // Measured tooltip box size, used to keep it on-screen (flip left / clamp).
  const tooltipBoxRef = useRef<HTMLDivElement | null>(null);
  const [boxSize, setBoxSize] = useState<{ w: number; h: number }>({
    w: 0,
    h: 0,
  });
  const mapRef = (window as any).mapRef;
  const featureAccessMap = useFeatureAccessMapStore(
    (s: FeatureAccessMapState) => s.map,
  );
  const featureMapLoading = useFeatureAccessMapStore(
    (s: FeatureAccessMapState) => s.featureMapLoading,
  );
  const topologyNodes = useUdpDataStore((s) => s.udpData.topology.nodes);
  // Live connections map (key → SNR) so a topology-LINK tooltip shows the current
  // signal, not the value captured when it was clicked.
  const topologyConnections = useUdpDataStore(
    (s) => s.udpData.topology.connections,
  );
  // Live mother-node id (topoForMcsa.node_id). Read from the store rather than
  // relying only on the `isMotherNode` flag baked into the picked data item, so a
  // change of mother between taps is reflected — the same reason the node and
  // connection tooltips above follow live data.
  const motherNodeId = useUdpDataStore((s) => s.udpData.topology.motherNodeId);

  // Lazy-load native feature map when user opens the topology tooltip (Android integrated / GIS APK).
  useEffect(() => {
    if (
      !hoverInfo?.layer?.id ||
      hoverInfo.layer.id !== "udp-topology-nodes-layer"
    ) {
      return;
    }
    if ((window as any).electronAPI) return;
    if (
      !Capacitor.isNativePlatform() ||
      Capacitor.getPlatform() !== "android"
    ) {
      return;
    }
    void useFeatureAccessMapStore.getState().refreshFromNative();
  }, [hoverInfo?.layer?.id]);
  // Precise per-pixel sampler for tiled rasters (native worker). Debounce is
  // shorter on coarse pointers (phones/tablets) so tap-to-inspect feels snappy.
  const tileSampler = useTileSampler(coarsePointer ? 0 : 140);

  // Fire the tile sampler whenever hover lands on a tiled layer with
  // valid lon/lat. Hover off a tiled layer → clear cached value.
  useEffect(() => {
    if (!hoverInfo) {
      tileSampler.request(null);
      return;
    }
    const deckLayerId = hoverInfo.layer?.id as string | undefined;
    if (!deckLayerId) {
      tileSampler.request(null);
      return;
    }
    const baseId = deckLayerId
      .replace(/-icon-layer$/, "")
      .replace(/-signal-overlay$/, "")
      .replace(/-bitmap$/, "")
      .replace(/-mesh$/, "");
    const matched = layers.find((l) => l.id === baseId);
    if (!matched?.tilesUrl) {
      tileSampler.request(null);
      return;
    }
    const coord = hoverInfo.coordinate;
    if (!coord || coord.length < 2) {
      tileSampler.request(null);
      return;
    }
    tileSampler.request({ layerId: matched.id, lon: coord[0], lat: coord[1] });
    // tileSampler is stable across renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hoverInfo, layers]);

  // Update tooltip position when map moves/zooms
  useEffect(() => {
    if (!hoverInfo || !mapRef?.current) {
      setTooltipPosition(null);
      return;
    }

    // Check if this is a DEM layer (may not have object)
    const deckLayerId = hoverInfo.layer?.id as string | undefined;
    let isDemLayer = false;
    if (deckLayerId) {
      const baseId = deckLayerId
        .replace(/-icon-layer$/, "")
        .replace(/-signal-overlay$/, "")
        .replace(/-bitmap$/, "")
        .replace(/-mesh$/, "");
      const matchingLayer = layers.find((l) => l.id === baseId);
      if (matchingLayer?.type === "dem") {
        isDemLayer = true;
      }
    }

    // For DEM layers, we might not have an object, but we should still position the tooltip
    if (!hoverInfo.object && !isDemLayer && !hoverInfo.coordinate) {
      setTooltipPosition(null);
      return;
    }

    const setPositionSafely = (x: number, y: number) => {
      const prev = lastTooltipPositionRef.current;
      // Ignore tiny sub-pixel shifts to reduce rerenders during pan.
      if (prev && Math.abs(prev.x - x) < 0.5 && Math.abs(prev.y - y) < 0.5) {
        return;
      }
      lastTooltipPositionRef.current = { x, y };
      setTooltipPosition({ x, y });
    };

    const updatePosition = () => {
      try {
        // Geodetic (plate-carrée) mode renders in a separate deck OrthographicView,
        // so the hidden mapbox map's project() would deviate. We still resolve the
        // feature's lng/lat below, then project it through the geodetic view's own
        // live camera so the tooltip TRACKS the feature on pan/zoom instead of
        // sticking to the stale pick pixel.
        const isGeodetic = !!(hoverInfo as unknown as { __geodetic?: boolean })
          .__geodetic;
        const map = mapRef.current.getMap();
        if (!map && !isGeodetic) return;

        // Get object coordinates
        let lng: number | undefined;
        let lat: number | undefined;

        // Live USER LOCATION — anchor to where the marker actually is now. The
        // marker is rebuilt from the store on every fix (~every 5-10 s), so
        // anchoring to the pick pixel left the box behind on the ground while the
        // marker walked away from it.
        if (deckLayerId === "user-location-layer" && userLocation) {
          lng = userLocation.lng;
          lat = userLocation.lat;
        }

        // Live topology node — follow UDP position between taps (pick snapshot is stale).
        if (deckLayerId === "udp-topology-nodes-layer" && hoverInfo.object) {
          const globalId = (hoverInfo.object as { globalId?: number }).globalId;
          const live =
            globalId !== undefined ? topologyNodes.get(globalId) : undefined;
          if (live) {
            lng = live.long;
            lat = live.lat;
          }
        }

        // Live topology CONNECTION — anchor at the midpoint of its two nodes' LIVE
        // positions so the tooltip tracks the moving link (not the click pixel).
        // Falls back to the click-time snapshot endpoints if a node isn't live.
        if (
          deckLayerId === "udp-topology-connections-layer" &&
          hoverInfo.object &&
          lng === undefined &&
          lat === undefined
        ) {
          const o = hoverInfo.object as {
            fromId?: number;
            toId?: number;
            from?: { longitude: number; latitude: number };
            to?: { longitude: number; latitude: number };
          };
          const f =
            o.fromId !== undefined ? topologyNodes.get(o.fromId) : undefined;
          const t =
            o.toId !== undefined ? topologyNodes.get(o.toId) : undefined;
          if (f && t) {
            lng = (f.long + t.long) / 2;
            lat = (f.lat + t.lat) / 2;
          } else if (o.from && o.to) {
            lng = (o.from.longitude + o.to.longitude) / 2;
            lat = (o.from.latitude + o.to.latitude) / 2;
          }
        }

        // ── Anchor resolution ───────────────────────────────────────────────
        // The order here is the OPPOSITE of what it used to be, and that was the
        // "tooltip floats away from the point" bug.
        //
        // It used to take `hoverInfo.coordinate` first, for everything. That is the
        // lng/lat under the cursor at PICK time — and deck picks within a radius
        // (20 px, 28 px on touch), so for a POINT it sits off the point's centre.
        // Frozen as a lng/lat, that offset re-projects to
        // `offset × 2^(zoomNow − zoomAtPick)` screen px: tap a point at z4, zoom in
        // 6 levels, and the tooltip is ~1280 px away — off-screen. It looked right
        // at the pick zoom because there the error is only the pick radius, which is
        // exactly the "correct at z2–z4, drifts as I zoom" symptom.
        //
        // So resolve the FEATURE's own position first — that is zoom-invariant —
        // and keep the cursor coordinate only for subjects that have no geometry
        // (rasters/DEM, where the sampled pixel under the cursor IS the subject).
        // Lines get the cursor coordinate SNAPPED onto the geometry, which removes
        // the perpendicular pick offset that made them drift more mildly.
        const picked: LngLat | null =
          hoverInfo.coordinate && hoverInfo.coordinate.length >= 2
            ? [hoverInfo.coordinate[0], hoverInfo.coordinate[1]]
            : null;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const obj = hoverInfo.object as any;
        const geom = obj?.geometry;
        const gType = geom?.type;
        const gCoords = geom?.coordinates;

        const setAnchor = (c: LngLat | null | undefined): boolean => {
          if (!c || !Number.isFinite(c[0]) || !Number.isFinite(c[1]))
            return false;
          lng = c[0];
          lat = c[1];
          return true;
        };

        // 1. POINT-LIKE — anchor at the exact centre.
        if (lng === undefined && lat === undefined) {
          if (
            gType === "Point" &&
            Array.isArray(gCoords) &&
            gCoords.length >= 2 &&
            !Array.isArray(gCoords[0])
          ) {
            setAnchor([gCoords[0], gCoords[1]]);
          } else if (Array.isArray(obj?.position) && obj.position.length >= 2) {
            // Sketch point layers: the deck data item IS the store layer.
            setAnchor([obj.position[0], obj.position[1]]);
          } else if (
            typeof obj?.longitude === "number" &&
            typeof obj?.latitude === "number"
          ) {
            setAnchor([obj.longitude, obj.latitude]);
          }
        }

        // 2. LINE-LIKE — collect the vertex paths. The actual snap happens AFTER
        //    projection (see `screenAnchor` below), because a straight deck line
        //    between two lng/lat points is straight in the RENDERER's space, not in
        //    degrees, so snapping here would land off the drawn line on mapbox.
        //    A midpoint/vertex is still resolved as the lng/lat fallback for when
        //    there is no pick to snap (e.g. a synthesised hover).
        const linePathsForSnap: ReadonlyArray<ReadonlyArray<number>>[] = [];
        if (lng === undefined && lat === undefined) {
          if (gType === "LineString" && isCoordPath(gCoords)) {
            linePathsForSnap.push(gCoords);
          } else if (gType === "MultiLineString" && Array.isArray(gCoords)) {
            for (const part of gCoords) {
              if (isCoordPath(part)) linePathsForSnap.push(part);
            }
          } else if (isCoordPath(obj?.path)) {
            linePathsForSnap.push(obj.path);
          } else if (
            Array.isArray(obj?.sourcePosition) &&
            Array.isArray(obj?.targetPosition) &&
            obj.sourcePosition.length >= 2 &&
            obj.targetPosition.length >= 2
          ) {
            linePathsForSnap.push([
              [obj.sourcePosition[0], obj.sourcePosition[1]],
              [obj.targetPosition[0], obj.targetPosition[1]],
            ]);
          }

          if (linePathsForSnap.length > 0) {
            // lng/lat fallback: the middle vertex of the first path, or the segment
            // midpoint. Only used if the screen-space snap cannot run.
            const first = linePathsForSnap[0];
            if (first.length === 2) {
              setAnchor([
                (first[0][0] + first[1][0]) / 2,
                (first[0][1] + first[1][1]) / 2,
              ]);
            } else {
              const mid = first[Math.floor(first.length / 2)];
              if (mid && mid.length >= 2) setAnchor([mid[0], mid[1]]);
            }
          }
        }

        // 3. AREAS, RASTERS, anything else — the picked coordinate. For a filled
        //    polygon the pick is INSIDE the feature, so it is already on the feature
        //    and stays correct at any zoom; preferring it over a ring vertex also
        //    avoids yanking the tooltip to a far corner. For a raster the sampled
        //    pixel under the cursor is the whole point.
        if (lng === undefined && lat === undefined) {
          if (!setAnchor(picked)) {
            if (
              gType === "Polygon" &&
              Array.isArray(gCoords) &&
              isCoordPath(gCoords[0])
            ) {
              setAnchor([gCoords[0][0][0], gCoords[0][0][1]]);
            } else if (Array.isArray(obj?.polygon)) {
              const ring = isCoordPath(obj.polygon[0])
                ? obj.polygon[0]
                : obj.polygon;
              if (isCoordPath(ring)) {
                setAnchor([ring[0][0], ring[0][1]]);
              }
            }
          }
        }

        // One projection for both placement and the line snap below, so the two can
        // never disagree about where a coordinate lands on screen.
        const projectLngLat = (
          plng: number,
          plat: number,
        ): { x: number; y: number } | null => {
          if (isGeodetic) {
            // The geodetic view's live camera, exposed on window by
            // GeodeticBasemapView (the covered mapbox map's project() would deviate).
            const gp = (
              window as unknown as {
                __geodeticProject?: (
                  lng: number,
                  lat: number,
                ) => { x: number; y: number };
              }
            ).__geodeticProject;
            const p = gp?.(plng, plat);
            return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? p : null;
          }
          const p = map.project([plng, plat]);
          return p && Number.isFinite(p.x) && Number.isFinite(p.y)
            ? { x: p.x, y: p.y }
            : null;
        };

        // ── Line anchors are snapped in SCREEN space, not in degrees ──────────
        // A deck line between two lng/lat points is drawn straight in the
        // RENDERER's space. On mapbox that is Web Mercator, where a straight chord
        // in degrees is CURVED — so a degree-space snap lands off the line that is
        // actually drawn, by an error that grows with zoom exactly like the bug it
        // was meant to fix (measured up to 242 px at z15.5 and 1397 px at z18 for a
        // ~300 km segment). Snapping after projection is correct in BOTH renderers,
        // because it uses whatever space the line is really drawn in, and it is
        // recomputed every frame so it stays exact at any zoom.
        let screenAnchor: { x: number; y: number } | null = null;
        if (picked && linePathsForSnap.length > 0) {
          const pickedPx = projectLngLat(picked[0], picked[1]);
          if (pickedPx) {
            let bestDistSq = Infinity;
            for (const path of linePathsForSnap) {
              let prev: { x: number; y: number } | null = null;
              for (const v of path) {
                const cur = v.length >= 2 ? projectLngLat(v[0], v[1]) : null;
                if (prev && cur) {
                  const c = closestPointOnSegment(
                    [pickedPx.x, pickedPx.y],
                    [prev.x, prev.y],
                    [cur.x, cur.y],
                  );
                  const dSq =
                    (c[0] - pickedPx.x) ** 2 + (c[1] - pickedPx.y) ** 2;
                  if (dSq < bestDistSq) {
                    bestDistSq = dSq;
                    screenAnchor = { x: c[0], y: c[1] };
                  }
                }
                if (cur) prev = cur;
              }
            }
          }
        }

        if (screenAnchor) {
          setPositionSafely(screenAnchor.x, screenAnchor.y);
        } else if (lng !== undefined && lat !== undefined) {
          const p = projectLngLat(lng, lat);
          if (p) {
            setPositionSafely(p.x, p.y);
          } else {
            setPositionSafely(hoverInfo.x || 0, hoverInfo.y || 0);
          }
        } else {
          // Fallback to original x, y if coordinates can't be determined
          setPositionSafely(hoverInfo.x || 0, hoverInfo.y || 0);
        }
      } catch (error) {
        // Fallback to original x, y on error
        setPositionSafely(hoverInfo.x || 0, hoverInfo.y || 0);
      }
    };

    updatePosition();

    // Keep the tooltip anchored to its feature on EVERY camera frame — pan AND,
    // crucially, ZOOM. Previously this re-projected only on discrete map "move" /
    // "zoom" / "geodetic-view-change" events; those can skip frames during a zoom
    // animation (and mapbox emits none at all in the geodetic view), so the tooltip
    // drifted off the feature — the "moves independently on zoom" bug. Re-projecting
    // once per animation frame from the LIVE camera (map.project / __geodeticProject,
    // via the SAME updatePosition that already handles x/y) follows the feature
    // exactly at any zoom level. `setPositionSafely` skips sub-pixel deltas so a
    // static tooltip forces no re-renders, and the loop stops when it closes.
    let rafId = requestAnimationFrame(function tick() {
      updatePosition();
      const m = mapRef.current?.getMap?.();
      if (m) {
        const z = m.getZoom();
        setMapZoom((prev) =>
          prev === null || Math.abs(prev - z) >= 0.01 ? z : prev,
        );
      }
      rafId = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(rafId);
    // `userLocation` must be a dependency, not just read inside: the rAF tick
    // closes over this render's value, so without it the loop would keep
    // re-projecting the position from the fix that was current when the tooltip
    // opened. A new fix arrives every 5-10 s, so this restarts the loop that often
    // — one cancelAnimationFrame + one requestAnimationFrame, which is nothing next
    // to the per-frame work it already does.
  }, [hoverInfo, mapRef, layers, topologyNodes, userLocation]);

  const object = useMemo(() => {
    if (!hoverInfo?.object) return hoverInfo?.object;
    if (hoverInfo.layer?.id !== "udp-topology-nodes-layer") {
      return hoverInfo.object;
    }
    return (
      liveTopologyTooltipObject(hoverInfo.object, topologyNodes) ??
      hoverInfo.object
    );
  }, [hoverInfo?.object, hoverInfo?.layer?.id, topologyNodes]);

  // Measure the rendered tooltip so we can flip/clamp it on-screen. Depends on
  // content drivers (not position), so it doesn't re-measure on every pan frame.
  useLayoutEffect(() => {
    const el = tooltipBoxRef.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    setBoxSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
  }, [hoverInfo, object, useIgrs, mapZoom]);

  if (!hoverInfo) {
    return null;
  }

  const { layer } = hoverInfo;

  // Check if user location is toggled off and this is user location layer
  if (layer?.id === "user-location-layer" && !showUserLocation) {
    return null;
  }

  // Use calculated position or fallback to original
  const x = tooltipPosition?.x ?? hoverInfo.x ?? 0;
  const y = tooltipPosition?.y ?? hoverInfo.y ?? 0;

  if (x === 0 && y === 0) {
    return null;
  }

  // Find the layer from the store using multiple strategies
  let layerInfo: (typeof layers)[0] | undefined = undefined;

  // Check if the object has a layerId (for line layers)
  if ((object as any)?.layerId) {
    layerInfo = layers.find((l) => l.id === (object as any).layerId);
  }
  // Check if the object is a LayerProps itself (for point/polygon layers).
  // Guarded: an uploaded GeoJSON feature with a top-level `id` (QGIS/ogr2ogr
  // write one) is also `{id, type}`-shaped, and used to match here — resolving
  // to NO layer, so the feature's tooltip lost its name/width and fell through
  // none of the later branches that need `layerInfo`.
  else if (isStoreLayerPickObject(object)) {
    layerInfo = layers.find((l) => l.id === (object as any).id);
  }
  // Combined deck layers (sketch POLYGONS and AZIMUTHS) render every feature in ONE
  // deck layer whose id ("polygon-layer" / "azimuth-lines-layer") matches no store
  // layer — instead each data item carries the FULL store layer on `object.layer`.
  // Without this, those tooltips can't find their name and fall back to a generic
  // "Polygon"/no-name. Prefer the live store copy; fall back to the embedded one.
  else if ((object as any)?.layer?.id) {
    layerInfo =
      layers.find((l) => l.id === (object as any).layer.id) ??
      ((object as any).layer as (typeof layers)[0]);
  }
  // Check if the deck.gl layer has an id that matches a store layer (for GeoJSON layers, node layers, etc.)
  else if (layer?.id) {
    const deckLayerId = layer.id;
    // Check if this ID matches a layer in the store directly
    layerInfo = layers.find((l) => l.id === deckLayerId);
    // If not found, check if it's a sub-layer (e.g., `${layer.id}-icon-layer`, `${layer.id}-bitmap`)
    if (!layerInfo) {
      // Try to extract the base layer ID by removing common suffixes
      const baseId = deckLayerId
        .replace(/-icon-layer$/, "")
        .replace(/-signal-overlay$/, "")
        .replace(/-bitmap$/, "")
        .replace(/-mesh$/, "");
      layerInfo = layers.find((l) => l.id === baseId);
    }
  }

  // If layer is found in store and is not visible, don't show tooltip
  // Exception: user-location-layer and other special layers that aren't in the store
  if (layerInfo && layerInfo.visible === false) {
    return null;
  }

  // NOTE: the tooltip is intentionally NOT zoom-gated here. A selected/hovered
  // feature's tooltip must stay attached to it until the feature is un-hovered,
  // explicitly closed, or another object is selected. The previous zoom-range check
  // compared the LIVE `mapZoom` against the layer's stored min/max, while the
  // feature's on-map visibility uses the DEBOUNCED, 0.5-rounded zoom — so mid-zoom
  // the two desynced and the tooltip vanished for a feature that was still visible,
  // reappearing on zoom-out (the "tooltip disappears at certain zoom levels" bug).
  // Visibility is already governed by the `layerInfo.visible === false` check above
  // (hidden layer → no tooltip) and by deck's hover clearing when the cursor leaves
  // the feature, so a dedicated zoom gate here is both redundant and wrong.

  const formatCoordinatePair = (point?: [number, number]) => {
    if (!point || point.length < 2) return "—";
    if (useIgrs) {
      const igrs = calculateIgrs(point[0], point[1]);
      if (igrs) return igrs;
    }
    return `[${point[1]?.toFixed(6)}°, ${point[0]?.toFixed(6)}°]`;
  };
  const coordinateLabel = useIgrs ? "IGRS" : "lat, lng";

  const getTooltipContent = () => {
    // Skip basic tooltip on polygon outline helper layers
    if (
      layer?.id === "polygon-outline-layer" ||
      layer?.id === "preview-polygon-outline-layer"
    ) {
      return null;
    }
    // Handle user location layer - show "Your Location" heading
    if (layer?.id === "user-location-layer") {
      if (!showUserLocation) return null;

      // LIVE position, not the pick snapshot.
      //
      // This used to read hoverInfo.coordinate (where the finger landed) or
      // object.position (the data item from the layer instance that existed when
      // you tapped). Both are frozen at pick time, so as you walked the marker moved
      // — it is rebuilt from the store every render — while the tooltip kept
      // reporting the old coordinates AND stayed anchored to the ground point you
      // tapped, drifting visibly away from the marker.
      //
      // The store's `userLocation` is what draws the marker, so reading it here
      // makes the two the same thing by construction. Same approach the UDP
      // topology-node branch below uses to follow its feed between taps.
      // The pick snapshot stays as a fallback for the frame before the first fix.
      let lng: number | undefined;
      let lat: number | undefined;

      if (userLocation) {
        lng = userLocation.lng;
        lat = userLocation.lat;
      } else if (hoverInfo.coordinate) {
        [lng, lat] = hoverInfo.coordinate;
      } else if (
        (object as any)?.position &&
        Array.isArray((object as any).position)
      ) {
        [lng, lat] = (object as any).position;
      }

      // Nothing to point at — the fix was dropped or tracking was turned off
      // between the tap and this render.
      if (lng === undefined || lat === undefined) return null;

      const properties: { label: string; value: string }[] = [
        {
          // formatCoordinatePair honours the IGRS toggle (and falls back to
          // lat/long outside the IGRS window, like every other coordinate row).
          label: coordinateLabel,
          value: formatCoordinatePair([lng, lat]),
        },
      ];

      return (
        <TooltipBox>
          <TooltipHeading title="Your Location" />
          <TooltipProperties properties={properties} />
        </TooltipBox>
      );
    }

    // ── Tiled raster layers — precise value via the gdal-async worker ──
    if (layerInfo?.type === "dem" && layerInfo.tilesUrl && layerInfo.bounds) {
      let lng: number | undefined;
      let lat: number | undefined;
      if (hoverInfo.coordinate) {
        [lng, lat] = hoverInfo.coordinate;
      }
      if (lng === undefined || lat === undefined) return null;

      const { value, dtype, loading } = tileSampler.state;
      const min = layerInfo.sourceValueMin;
      const max = layerInfo.sourceValueMax;

      const hasValue =
        value !== null && value !== undefined && Number.isFinite(value);

      // While sampling: show coords + "…" so tap-to-inspect feels immediate.
      // After sampling: hide only when we know the pixel is NoData (still no value).
      // NOTE: this is a DATA check, not a display one — it stays independent of
      // the row selection below, so hiding the Value row can never make a live
      // raster tooltip vanish.
      if (!hasValue && !loading) {
        return null;
      }

      // Row selection from the layer's "Tooltip Attributes" panel. Unconfigured
      // (undefined) shows every row.
      const showRow = (key: string) => isRasterTooltipAttrShown(layerInfo, key);

      const properties: { label: string; value: string }[] = [];
      if (useIgrs) {
        // IGRS collapses Latitude + Longitude into one row, gated by LATITUDE.
        if (showRow(RASTER_TOOLTIP_ATTRIBUTES.LATITUDE)) {
          properties.push({
            label: "IGRS",
            value: calculateIgrs(lng, lat) ?? "—",
          });
        }
      } else {
        if (showRow(RASTER_TOOLTIP_ATTRIBUTES.LATITUDE)) {
          properties.push({
            label: "Latitude",
            value: `${lat.toFixed(6)}°`,
          });
        }
        if (showRow(RASTER_TOOLTIP_ATTRIBUTES.LONGITUDE)) {
          properties.push({ label: "Longitude", value: `${lng.toFixed(6)}°` });
        }
      }

      let valueLabel = "Value";
      if (dtype && /Float/i.test(dtype)) valueLabel = "Value";
      else if (layerInfo.sourceDtype === "Byte") valueLabel = "Class";

      let valueStr = "—";
      if (hasValue) {
        valueStr = Number.isInteger(value as number)
          ? String(value)
          : (value as number).toFixed(2);
      } else if (loading) {
        valueStr = "…";
      }

      if (showRow(RASTER_TOOLTIP_ATTRIBUTES.VALUE)) {
        properties.push({
          label: valueLabel,
          value: valueStr,
        });
      }
      if (
        showRow(RASTER_TOOLTIP_ATTRIBUTES.RANGE) &&
        typeof min === "number" &&
        typeof max === "number"
      ) {
        properties.push({
          label: "Range",
          value: `${min.toFixed(2)} – ${max.toFixed(2)}`,
        });
      }
      if (showRow(RASTER_TOOLTIP_ATTRIBUTES.CRS) && layerInfo.sourceCrs) {
        properties.push({ label: "CRS", value: String(layerInfo.sourceCrs) });
      }

      return (
        <TooltipBox maxWidth="max-w-[220px]">
          {layerInfo.name && (
            <TooltipHeading title={layerInfo.name.toUpperCase()} />
          )}
          <TooltipProperties properties={properties} />
        </TooltipBox>
      );
    }

    // Handle DEM (elevation raster) layers - show elevation at hovered point
    if (
      layerInfo?.type === "dem" &&
      layerInfo.elevationData &&
      layerInfo.bounds
    ) {
      const demObject: any = object || {};

      // Try to get coordinates from multiple sources
      let lng: number | undefined;
      let lat: number | undefined;

      if (hoverInfo.coordinate) {
        [lng, lat] = hoverInfo.coordinate;
      } else if (demObject.geometry?.coordinates) {
        // GeoJSON Point
        if (
          Array.isArray(demObject.geometry.coordinates) &&
          demObject.geometry.coordinates.length >= 2
        ) {
          lng = demObject.geometry.coordinates[0];
          lat = demObject.geometry.coordinates[1];
        }
      } else if (
        demObject.longitude !== undefined &&
        demObject.latitude !== undefined
      ) {
        lng = demObject.longitude;
        lat = demObject.latitude;
      } else if (demObject.position && Array.isArray(demObject.position)) {
        lng = demObject.position[0];
        lat = demObject.position[1];
      }

      if (lng !== undefined && lat !== undefined) {
        const [[minLng, minLat], [maxLng, maxLat]] = layerInfo.bounds;

        // Ensure the hover point is within the DEM bounds
        if (lng >= minLng && lng <= maxLng && lat >= minLat && lat <= maxLat) {
          const { width, height, data, min, max } = layerInfo.elevationData;

          // Map geographic coordinates to raster pixel indices
          const col = ((lng - minLng) / (maxLng - minLng || 1)) * (width - 1);
          const row = ((maxLat - lat) / (maxLat - minLat || 1)) * (height - 1);

          const x = Math.min(width - 1, Math.max(0, Math.round(col)));
          const y = Math.min(height - 1, Math.max(0, Math.round(row)));
          const index = y * width + x;

          const elevation = data[index];

          const hasValidElevation =
            Number.isFinite(elevation) &&
            elevation !== null &&
            elevation !== undefined;

          // Row selection from the layer's "Tooltip Attributes" panel.
          // Unconfigured (undefined) shows every row.
          const showRow = (key: string) =>
            isRasterTooltipAttrShown(layerInfo, key);

          const properties: { label: string; value: string }[] = [];
          if (useIgrs) {
            // IGRS collapses Latitude + Longitude into one row, gated by LATITUDE.
            if (showRow(RASTER_TOOLTIP_ATTRIBUTES.LATITUDE)) {
              properties.push({
                label: "IGRS",
                value: calculateIgrs(lng, lat) ?? "—",
              });
            }
          } else {
            if (showRow(RASTER_TOOLTIP_ATTRIBUTES.LATITUDE)) {
              properties.push({
                label: "Latitude",
                value: `${lat.toFixed(6)}°`,
              });
            }
            if (showRow(RASTER_TOOLTIP_ATTRIBUTES.LONGITUDE)) {
              properties.push({
                label: "Longitude",
                value: `${lng.toFixed(6)}°`,
              });
            }
          }

          if (showRow(RASTER_TOOLTIP_ATTRIBUTES.PIXEL_INDEX)) {
            properties.push({ label: "Pixel Index", value: `(${x}, ${y})` });
          }
          if (showRow(RASTER_TOOLTIP_ATTRIBUTES.VALUE)) {
            properties.push({
              label: "Elevation",
              value: hasValidElevation
                ? `${elevation.toFixed(2)} m`
                : "No data",
            });
          }
          if (showRow(RASTER_TOOLTIP_ATTRIBUTES.RANGE)) {
            properties.push({
              label: "Elevation Range",
              value: `${min.toFixed(1)}–${max.toFixed(1)} m`,
            });
          }
          if (showRow(RASTER_TOOLTIP_ATTRIBUTES.RASTER_SIZE)) {
            properties.push({
              label: "Raster Size",
              value: `${width} × ${height} px`,
            });
          }

          return (
            <TooltipBox maxWidth="max-w-[200px]">
              {layerInfo.name && (
                <TooltipHeading title={layerInfo.name.toUpperCase()} />
              )}
              <TooltipProperties properties={properties} />
            </TooltipBox>
          );
        }
      }
    }

    // For non-DEM content, we require a valid object to render a tooltip
    if (!object) {
      return null;
    }

    // Topology CONNECTION line (an edge between two nodes). Its data item is
    // { from, to, snr, ... } — NOT sourcePosition/targetPosition — so it used to
    // fall through to the generic "Map Feature / Hover for details" placeholder.
    // Show the link's actual info (signal quality + geometry) instead.
    if (
      layer?.id === "udp-topology-connections-layer" &&
      (object as any)?.from &&
      (object as any)?.to
    ) {
      const o = object as any;
      // Re-read the endpoints from the LIVE node map (fall back to the click-time
      // snapshot), so coordinates + distance update as the aircraft move.
      const liveFrom =
        o.fromId !== undefined ? topologyNodes.get(o.fromId) : undefined;
      const liveTo =
        o.toId !== undefined ? topologyNodes.get(o.toId) : undefined;
      const from: [number, number] = liveFrom
        ? [liveFrom.long, liveFrom.lat]
        : [o.from.longitude, o.from.latitude];
      const to: [number, number] = liveTo
        ? [liveTo.long, liveTo.lat]
        : [o.to.longitude, o.to.latitude];
      // Live SNR from the connections map (fall back to the snapshot value).
      const liveSnr =
        o.connectionKey !== undefined
          ? topologyConnections.get(o.connectionKey)
          : undefined;
      const snr = liveSnr ?? o.snr;
      const properties: { label: string; value: string }[] = [];
      if (snr !== undefined && snr !== null && !Number.isNaN(Number(snr))) {
        properties.push({ label: "SNR", value: `${snr} dB` });
      }
      properties.push(
        {
          label: "Distance",
          value: `${parseFloat(getDistance(from, to)).toFixed(2)} km`,
        },
        {
          label: `From (${coordinateLabel})`,
          value: formatCoordinatePair(from),
        },
        { label: `To (${coordinateLabel})`, value: formatCoordinatePair(to) },
      );
      return (
        <TooltipBox>
          <TooltipHeading title="Topology Link" />
          <TooltipProperties properties={properties} />
        </TooltipBox>
      );
    }

    // Handle UDP layers
    if (
      layer?.id === "udp-network-members-layer" ||
      layer?.id === "udp-targets-layer" ||
      layer?.id === "udp-topology-nodes-layer"
    ) {
      const importantKeys = [
        "globalId",
        "callsign",
        "altitude",
        "heading",
        "trueHeading",
        "groundSpeed",
        "range",
        "displayId",
        "role",
        "controllingNodeId",
        "id",
        "neighborCount",
      ];

      const properties = [];
      if (object.longitude !== undefined && object.latitude !== undefined) {
        properties.push({
          label: "Location",
          value: useIgrs
            ? calculateIgrs(object.longitude, object.latitude) ||
              `[${object.latitude.toFixed(6)}°, ${object.longitude.toFixed(6)}°]`
            : `[${object.latitude.toFixed(6)}°, ${object.longitude.toFixed(6)}°]`,
        });
      }
      if (
        layer.id === "udp-topology-nodes-layer" &&
        object.altitude !== undefined &&
        object.altitude !== null &&
        !Number.isNaN(Number(object.altitude))
      ) {
        properties.push({
          label: "Altitude",
          // Wire value is in units of 4 feet, so scale to metres before showing
          // it, at 2 dp (HSC, 17 Aug). It used to print the raw UINT16 with
          // `toFixed(0)` and an "m" suffix, which was wrong by a factor of 1.2192.
          value: `${(
            Number(object.altitude) * TOPOLOGY_ALTITUDE_RESOLUTION_M
          ).toFixed(2)} m`,
        });
      }

      // Is this the mother node? The live id from the store WINS when we have one;
      // the `isMotherNode` flag that udp-layers.tsx bakes into the data item is only
      // a fallback for when we do not.
      //
      // The two must not be OR-ed: the flag is a snapshot from when the node was
      // tapped, so if the mother moves to another node afterwards the old node still
      // carries `isMotherNode: true` and an OR would keep labelling it "Mother Node"
      // when it no longer is. Live data overriding the snapshot is the whole point.
      const pickedGlobalId = (object as { globalId?: unknown }).globalId;
      const isMotherNode =
        motherNodeId !== null && typeof pickedGlobalId === "number"
          ? pickedGlobalId === motherNodeId
          : (object as { isMotherNode?: unknown }).isMotherNode === true;

      const displayProperties = Object.entries(object)
        .filter(
          ([key, value]) =>
            importantKeys.includes(key) &&
            !(layer.id === "udp-topology-nodes-layer" && key === "altitude") &&
            value !== undefined &&
            value !== null &&
            typeof value !== "object",
        )
        .map(([key, value]) => ({
          label: formatLabel(key),
          value:
            typeof value === "number" && !Number.isInteger(value)
              ? value.toFixed(2)
              : String(value),
        }));

      const useGridLayout = displayProperties.length > 8;

      const notifyUdpMemberAction = async (
        action: "video" | "ftp" | "call" | "message" | "stream",
        fallbackAlert: string,
      ) => {
        if (layer.id !== "udp-topology-nodes-layer") {
          console.warn(
            "[MemberAction] Native actions are only sent for topology nodes (object.ip); not notifying.",
          );
          return;
        }
        const globalId = topologyMemberActionGlobalId(
          object as Record<string, unknown>,
        );
        try {
          await MemberAction.notifyAction({ globalId, action });
        } catch (err) {
          console.warn("[MemberAction] Plugin not available:", err);
          alert(fallbackAlert);
        }
      };

      const topologyPeerIp = topologyMemberActionGlobalId(
        object as Record<string, unknown>,
      );
      const topologyActions = getTopologyTooltipActions(
        topologyPeerIp,
        featureAccessMap,
      );
      const lazyTopologyNativeActions =
        !isDesktopBuild &&
        Capacitor.isNativePlatform() &&
        Capacitor.getPlatform() === "android";
      const showTopologyActionsSkeleton =
        lazyTopologyNativeActions &&
        layer.id === "udp-topology-nodes-layer" &&
        featureMapLoading;
      const showTopologyActions =
        lazyTopologyNativeActions &&
        layer.id === "udp-topology-nodes-layer" &&
        !featureMapLoading &&
        hasAnyTopologyTooltipAction(topologyActions);

      return (
        <TooltipBox
          maxWidth={useGridLayout ? "max-w-[380px]" : "max-w-[200px]"}
          style={{ maxHeight: "450px", overflowY: "auto" }}
        >
          <TooltipHeading
            title={
              layer.id === "udp-network-members-layer"
                ? "Network Member"
                : layer.id === "udp-topology-nodes-layer"
                  ? isMotherNode
                    ? "Mother Node"
                    : "Topology Node"
                  : "Target"
            }
          />
          {properties.length > 0 && (
            <>
              <TooltipProperties properties={properties} />
              <TooltipDivider />
            </>
          )}
          <TooltipProperties
            properties={displayProperties}
            useGridLayout={useGridLayout}
          />
          {showTopologyActionsSkeleton && (
            <>
              <div
                className="grid grid-cols-2 gap-2"
                aria-busy="true"
                aria-label="Loading actions"
              >
                {[0, 1, 2, 3, 4].map((i) => (
                  <div
                    key={i}
                    className="h-8 rounded-md bg-neutral-700/40 animate-pulse"
                  />
                ))}
              </div>
            </>
          )}
          {showTopologyActions && (
            <>
              <TooltipDivider />
              <div className="grid grid-cols-2 gap-2">
                {topologyActions.video && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      void notifyUdpMemberAction(
                        "video",
                        "Video call initiated",
                      );
                    }}
                    className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs text-white rounded-md transition-all hover:opacity-90"
                    style={{ backgroundColor: "#7F1D1D" }}
                    title="Video Call"
                  >
                    <Video size={12} />
                    <span>Video</span>
                  </button>
                )}
                {topologyActions.ftp && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      void notifyUdpMemberAction(
                        "ftp",
                        "FTP connection initiated",
                      );
                    }}
                    className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs text-white rounded-md transition-all hover:opacity-90"
                    style={{ backgroundColor: "#3F6212" }}
                    title="File Transfer"
                  >
                    <Upload size={12} />
                    <span>FTP</span>
                  </button>
                )}
                {topologyActions.call && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      void notifyUdpMemberAction(
                        "call",
                        "Phone call initiated",
                      );
                    }}
                    className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs text-white rounded-md transition-all hover:opacity-90"
                    style={{ backgroundColor: "#1E3A8A" }}
                    title="Voice Call"
                  >
                    <PhoneCall className="size-3" />
                    <span>Call</span>
                  </button>
                )}
                {topologyActions.message && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      void notifyUdpMemberAction("message", "Message sent");
                    }}
                    className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs text-white rounded-md transition-all hover:opacity-90"
                    style={{ backgroundColor: "#A16207" }}
                    title="Send Message"
                  >
                    <MessageSquare size={12} />
                    <span>Message</span>
                  </button>
                )}
                {/* Streaming — BugID 285. Same availability rule as the others
                    (a feature id present in this IP's list), and the callback sends
                    the literal action "stream", which native forwards verbatim. */}
                {topologyActions.stream && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      void notifyUdpMemberAction(
                        "stream",
                        "Streaming initiated",
                      );
                    }}
                    className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs text-white rounded-md transition-all hover:opacity-90"
                    style={{ backgroundColor: "#5B21B6" }}
                    title="Streaming"
                  >
                    <MonitorPlay size={12} />
                    <span>Stream</span>
                  </button>
                )}
              </div>
            </>
          )}
        </TooltipBox>
      );
    }

    const isDirectNodeObject =
      object.hasOwnProperty("snr") &&
      object.hasOwnProperty("rssi") &&
      object.hasOwnProperty("userId") &&
      object.hasOwnProperty("hopCount");

    if (layerInfo?.type === "azimuth") {
      const isNorthSegment = (object as any)?.segmentType === "north";
      const angleDeg = isNorthSegment
        ? 0
        : azimuthDisplayAngle(layerInfo.azimuthAngleDeg ?? 0);
      const distanceMeters = isNorthSegment
        ? undefined
        : layerInfo.distanceMeters;

      const properties = [
        {
          label: "Bearing angle",
          value: isNorthSegment
            ? "0° (reference axis)"
            : `${angleDeg.toFixed(1)}°`,
        },
      ];

      if (distanceMeters !== undefined) {
        properties.push({
          label: "Distance",
          value: formatDistance(distanceMeters / 1000),
        });
      }

      properties.push(
        {
          label: `Center (${coordinateLabel})`,
          value: formatCoordinatePair(layerInfo.azimuthCenter),
        },
        {
          label: `Target (${coordinateLabel})`,
          value: formatCoordinatePair(layerInfo.azimuthTarget),
        },
      );

      return (
        <TooltipBox>
          <TooltipHeading
            title={layerInfo?.name ?? "Azimuth"}
            subtitle="Bearing Calculation"
          />
          <TooltipProperties properties={properties} />
        </TooltipBox>
      );
    }

    if (isDirectNodeObject) {
      const properties = [
        { label: "User ID", value: String(object.userId) },
        { label: "SNR", value: `${object.snr} dB` },
        { label: "RSSI", value: `${object.rssi} dBm` },
        {
          label: "Distance",
          value: `${object.distance?.toFixed(2)} m`,
        },
        { label: "Hop Count", value: String(object.hopCount) },
      ];

      if (object.connectedNodeIds && object.connectedNodeIds.length > 0) {
        properties.push({
          label: "Connected Nodes",
          value: `[${object.connectedNodeIds.join(", ")}]`,
        });
      }

      properties.push({
        label: `Location (${coordinateLabel})`,
        value: formatCoordinatePair([object.longitude, object.latitude]),
      });

      return (
        <TooltipBox>
          {layerInfo?.name && <TooltipHeading title={layerInfo.name} />}
          <TooltipHeading title="Network Node" />
          <TooltipProperties properties={properties} />
          <TooltipDivider />
          <div className="text-gray-600" style={{ fontSize: "0.9em" }}>
            Click on the node to change its icon
          </div>
        </TooltipBox>
      );
    }

    if (object.geometry) {
      const geometryType = object.geometry.type;
      const properties = object.properties || {};

      const isNodeFeature =
        properties.hasOwnProperty("snr") &&
        properties.hasOwnProperty("rssi") &&
        properties.hasOwnProperty("userId") &&
        properties.hasOwnProperty("hopCount");

      if (isNodeFeature) {
        const nodeProperties = [
          { label: "User ID", value: String(properties.userId) },
          { label: "SNR", value: `${properties.snr} dB` },
          { label: "RSSI", value: `${properties.rssi} dBm` },
          {
            label: "Distance",
            value: `${properties.distance?.toFixed(2)} m`,
          },
          { label: "Hop Count", value: String(properties.hopCount) },
        ];

        if (
          properties.connectedNodeIds &&
          properties.connectedNodeIds.length > 0
        ) {
          nodeProperties.push({
            label: "Connected Nodes",
            value: `[${properties.connectedNodeIds.join(", ")}]`,
          });
        }

        if (geometryType === "Point" && object.geometry.coordinates) {
          nodeProperties.push({
            label: `Location (${coordinateLabel})`,
            value: formatCoordinatePair(
              object.geometry.coordinates as [number, number],
            ),
          });
        }

        return (
          <TooltipBox>
            {layerInfo?.name && <TooltipHeading title={layerInfo.name} />}
            <TooltipHeading title="Network Node" />
            <TooltipProperties properties={nodeProperties} />
            <TooltipDivider />
            <div className="text-gray-600" style={{ fontSize: "0.9em" }}>
              Click on the node to change its icon
            </div>
          </TooltipBox>
        );
      }

      // Regular GeoJSON feature (non-Node)
      let geometryInfo = null;

      // Calculate distance for LineString
      if (
        geometryType === "LineString" &&
        object.geometry.coordinates &&
        object.geometry.coordinates.length >= 2
      ) {
        let totalDistance = 0;
        for (let i = 0; i < object.geometry.coordinates.length - 1; i++) {
          totalDistance += parseFloat(
            getDistance(
              [
                object.geometry.coordinates[i][0],
                object.geometry.coordinates[i][1],
              ],
              [
                object.geometry.coordinates[i + 1][0],
                object.geometry.coordinates[i + 1][1],
              ],
            ),
          );
        }
        geometryInfo = `Distance: ${totalDistance.toFixed(2)} km`;
      }

      // Calculate area for Polygon
      if (
        geometryType === "Polygon" &&
        object.geometry.coordinates &&
        object.geometry.coordinates[0]
      ) {
        const areaMeters = computePolygonAreaMeters(
          object.geometry.coordinates,
        );
        geometryInfo = `Area: ${formatArea(areaMeters)}`;
      }

      const tooltipProperties = [];

      if (geometryType === "Point" && layerInfo?.pointRadius) {
        tooltipProperties.push({
          label: "Radius",
          value: `${layerInfo.pointRadius.toLocaleString()} px`,
        });
      }

      if (geometryType === "LineString" && layerInfo?.lineWidth) {
        tooltipProperties.push({
          label: "Width",
          value: `${layerInfo.lineWidth} px`,
        });
      }

      const isShortestRoute = !!layerInfo && isShortestRouteLayer(layerInfo);

      if (
        isShortestRoute &&
        geometryType === "LineString" &&
        object.geometry.coordinates &&
        object.geometry.coordinates.length >= 2
      ) {
        const coords = object.geometry.coordinates;
        const from = coords[0] as [number, number];
        const to = coords[coords.length - 1] as [number, number];
        tooltipProperties.push(
          {
            label: `From (${coordinateLabel})`,
            value: formatCoordinatePair(from),
          },
          {
            label: `To (${coordinateLabel})`,
            value: formatCoordinatePair(to),
          },
        );
      }

      if (geometryInfo) {
        tooltipProperties.push({
          label: geometryInfo.split(":")[0],
          value: geometryInfo.split(":")[1]?.trim() || "",
        });
      }

      // NOTE: no synthetic "Coordinates" row for uploaded features.
      //
      // One used to be pushed here for Point geometries (added in c02f5042). It was
      // removed on request: an uploaded file very often carries its OWN latitude /
      // longitude attribute columns, and those are rendered verbatim among the
      // feature attributes below — so the tooltip showed the position twice, once
      // from us and once from the file. The file's own columns are DATA and are
      // shown exactly as authored; adding a second, differently-formatted copy on
      // top was the redundancy. If a coordinate readout is wanted here again, it
      // belongs behind the layer's "Tooltip Attributes" selection like every other
      // row, not as an unconditional extra.

      // Feature attribute rows. Two modes:
      //  • No selection yet (undefined): show only meaningful values, alphabetically,
      //    capped — a compact, well-positioned default for big-schema features.
      //  • Explicit selection (array, from the layer's "Tooltip Attributes" panel):
      //    AUTHORITATIVE — show EXACTLY the ticked keys, in full, no cap, and render
      //    a ticked-but-empty/absent field as "—" so "ticked = shown" always holds
      //    (e.g. a field that exists on other features but is blank on this one).
      const attrWhitelist = layerInfo?.tooltipAttributes;
      let hiddenAttrCount = 0;

      // An uploaded file very often carries its position as its OWN Latitude and
      // Longitude COLUMNS ("Airtel Sites" has Latitude 28.4482 / Longitude
      // 76.99089; "All Highways" the same). Those are attribute rows, so they went
      // straight through formatTooltipValue and stayed in degrees with IGRS on —
      // the toggle appeared to do nothing on exactly the layers where the position
      // is most useful. They are the same quantity our own coordinate rows convert,
      // so they honour the toggle too, collapsed into ONE grid reference the way
      // the raster tooltip already does it (see RASTER_TOOLTIP_ATTRIBUTES above).
      //
      // Deliberately narrow, because these are the user's data columns: only
      // recognised coordinate names, only finite numbers, and only when
      // calculateIgrs actually yields a reference. Anything else — a projected
      // X/Y, a text field, a point outside the IGRS window — is left exactly as
      // authored rather than guessed at.
      // Which columns ARE the coordinate pair. Resolved once, independently of the
      // IGRS toggle, because it drives two things: the IGRS collapse below, and —
      // when IGRS is off or unavailable — printing them as DEGREES. Left as bare
      // numbers they were the only coordinates in the app without a ° on them.
      const coordAttrKeys = (() => {
        const norm = (k: string) => k.toLowerCase().replace(/[\s_-]/g, "");
        let latKey: string | undefined;
        let lonKey: string | undefined;
        for (const key of Object.keys(properties)) {
          const n = norm(key);
          if (!latKey && (n === "latitude" || n === "lat")) latKey = key;
          else if (
            !lonKey &&
            (n === "longitude" || n === "long" || n === "lon" || n === "lng")
          ) {
            lonKey = key;
          }
        }
        if (!latKey || !lonKey) return null;
        const lat = Number((properties as Record<string, unknown>)[latKey]);
        const lon = Number((properties as Record<string, unknown>)[lonKey]);
        // Both must be real numbers before we treat either as a coordinate — a
        // text "N/A" or a projected easting stays exactly as authored.
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
        return { latKey, lonKey, lat, lon };
      })();

      const igrsAttrPair = (() => {
        if (!useIgrs || !coordAttrKeys) return null;
        const igrs = calculateIgrs(coordAttrKeys.lon, coordAttrKeys.lat);
        if (!igrs) return null; // outside the IGRS window — keep the raw columns
        return {
          latKey: coordAttrKeys.latKey,
          lonKey: coordAttrKeys.lonKey,
          igrs,
        };
      })();

      /**
       * Emit one attribute row, folding the coordinate pair into a single IGRS row.
       * The grid reference takes the LATITUDE slot (alphabetically first of the
       * pair, so ordering is unchanged) and the longitude row is dropped, since
       * both numbers are already inside the one reference.
       */
      const pushAttrRow = (
        key: string,
        value: unknown,
        missingAsDash = false,
      ) => {
        if (igrsAttrPair) {
          if (key === igrsAttrPair.lonKey) return;
          if (key === igrsAttrPair.latKey) {
            tooltipProperties.push({ label: "IGRS", value: igrsAttrPair.igrs });
            return;
          }
        }
        const missing = missingAsDash && !isMeaningfulPropertyValue(value);
        // A recognised lat/long COLUMN is a coordinate, so print it like every
        // other coordinate in the app: with a degree sign. Reached only when the
        // IGRS collapse above did not apply — toggle off, or a point outside the
        // IGRS window — so the two can never both format the same row.
        const isCoordCol =
          !missing &&
          coordAttrKeys !== null &&
          (key === coordAttrKeys.latKey || key === coordAttrKeys.lonKey);
        tooltipProperties.push({
          label: formatAttributeLabel(key),
          value: missing
            ? "—"
            : isCoordCol
              ? `${Number(value).toFixed(6)}°`
              : formatTooltipValue(key, value),
        });
      };

      if (attrWhitelist === undefined) {
        const meaningful = Object.entries(properties)
          .filter(
            ([key, value]) =>
              isMeaningfulPropertyValue(value) &&
              !(
                isShortestRoute && SHORTEST_ROUTE_TOOLTIP_HIDDEN_PROPS.has(key)
              ),
          )
          .sort(([a], [b]) => a.localeCompare(b));
        const shown = meaningful.slice(0, TOOLTIP_DEFAULT_ATTR_LIMIT);
        hiddenAttrCount = meaningful.length - shown.length;
        shown.forEach(([key, value]) => pushAttrRow(key, value));
      } else {
        // An explicit selection is AUTHORITATIVE: show EXACTLY the ticked keys.
        // Do NOT apply SHORTEST_ROUTE_TOOLTIP_HIDDEN_PROPS here — that filter is for
        // the no-selection DEFAULT only. Applying it to an explicit whitelist made
        // ticking/unticking a route's attributes do nothing (all of a route's
        // properties live in the hidden set), breaking "ticked = shown".
        [...attrWhitelist]
          .sort((a, b) => a.localeCompare(b))
          .slice(0, TOOLTIP_DEFAULT_ATTR_LIMIT) // hard cap, mirrors the panel limit
          .forEach((key) => {
            const value = (properties as Record<string, unknown>)[key];
            // `true` keeps the whitelist's "ticked = shown" rule: a ticked field
            // that is empty on THIS feature still renders, as "—".
            pushAttrRow(key, value, true);
          });
      }

      // Threshold 8, matching the raster branch above (which already used 8).
      //
      // It was 10, and that one-row cliff caused a real regression: removing the
      // synthetic "Coordinates" row took a typical feature from 11 rows to 10,
      // flipping this false. The box then switched from the 2-column 380px grid to
      // the 1-column 200px layout, roughly doubling its height, overflowing the
      // 60vh cap below and growing a scrollbar — for a feature that had fitted
      // fine a moment earlier. 8 also means 9- and 10-row features now use the
      // grid, which they should have all along: at ~46px per row they exceeded
      // 60vh in a single column on any normal screen.
      const useGridLayout = tooltipProperties.length > 8;

      return (
        <TooltipBox
          maxWidth={useGridLayout ? "max-w-[380px]" : "max-w-[200px]"}
          style={{
            // A feature with many attributes (e.g. 100 fields) would otherwise make
            // the box taller than the screen; the on-screen clamp then pins it to
            // the top edge, so it lands far from the cursor and reads as "not
            // opening". Cap the height and let it scroll. pointerEvents:auto
            // re-enables scrolling for THIS box even though the positioning wrapper
            // is pointerEvents:none. (Trimming fields via the layer's "Tooltip
            // Attributes" selector remains the way to make it compact.)
            maxHeight: "60vh",
            overflowY: "auto",
            pointerEvents: "auto",
          }}
        >
          {layerInfo?.name && (
            <TooltipHeading
              // Use the layer's actual (renamable) name, not the hardcoded
              // "Shortest Route" prefix — otherwise a rename never shows here.
              title={layerInfo.name}
              // No subheading for a shortest route. It used to print the
              // coordinate pair "(lat, lng to lat, lng)", which repeated the
              // From / To rows sitting immediately below it — and cost two lines
              // of height in a box already capped at 60vh. The layer card in the
              // console still shows that subtitle, where there are no From / To
              // rows to duplicate.
              subtitle={isShortestRoute ? undefined : `${geometryType} Feature`}
            />
          )}
          <TooltipProperties
            properties={tooltipProperties}
            useGridLayout={useGridLayout}
          />
          {hiddenAttrCount > 0 && (
            <div className="mt-1 text-gray-500" style={{ fontSize: "0.85em" }}>
              +{hiddenAttrCount} more field{hiddenAttrCount === 1 ? "" : "s"} —
              choose which to show in layer settings
            </div>
          )}
        </TooltipBox>
      );
    }

    if (object.sourcePosition && object.targetPosition) {
      const distance = getDistance(
        [object.sourcePosition[0], object.sourcePosition[1]],
        [object.targetPosition[0], object.targetPosition[1]],
      );
      const segmentDistances = Array.isArray(layerInfo?.segmentDistancesKm)
        ? layerInfo.segmentDistancesKm
        : [];
      const segmentsTotalKm =
        layerInfo?.totalDistanceKm ??
        segmentDistances.reduce((sum, dist) => sum + dist, 0);
      const segmentCount = segmentDistances.length;
      const maxSegmentKm =
        segmentCount > 0 ? Math.max(...segmentDistances) : null;
      const minSegmentKm =
        segmentCount > 0 ? Math.min(...segmentDistances) : null;
      const avgSegmentKm =
        segmentCount > 0 ? segmentsTotalKm / segmentCount : null;

      const properties = [];

      if (layerInfo?.lineWidth || object.width) {
        properties.push({
          label: "Width",
          value: `${layerInfo?.lineWidth || object.width} px`,
        });
      }

      properties.push({
        label: "Distance",
        value: `${parseFloat(distance).toFixed(2)} km`,
      });

      if (segmentCount) {
        properties.push({
          label: "Total Segments",
          value: String(segmentCount),
        });

        if (segmentCount > 1) {
          properties.push(
            {
              label: "Max segment",
              value: formatDistance(maxSegmentKm ?? 0),
            },
            {
              label: "Min segment",
              value: formatDistance(minSegmentKm ?? 0),
            },
            {
              label: "Avg segment",
              value: formatDistance(avgSegmentKm ?? 0),
            },
          );
        } else {
          properties.push({
            label: "Segment length",
            value: formatDistance(segmentDistances[0]),
          });
        }

        properties.push({
          label: "Total",
          value: formatDistance(segmentsTotalKm),
        });
      }

      properties.push(
        {
          label: `From (${coordinateLabel})`,
          value: formatCoordinatePair(
            object.sourcePosition as [number, number],
          ),
        },
        {
          label: `To (${coordinateLabel})`,
          value: formatCoordinatePair(
            object.targetPosition as [number, number],
          ),
        },
      );

      return (
        <TooltipBox>
          {layerInfo?.name && (
            <TooltipHeading title={layerInfo.name} subtitle="Line Segment" />
          )}
          <TooltipProperties properties={properties} />
        </TooltipBox>
      );
    }

    // A hovered vertex of a drawn polygon reports ITS OWN coordinates, not the
    // parent polygon's area/perimeter. Deliberately above the generic
    // `object.position` branch, which matches any datum carrying a position and
    // would otherwise claim this one.
    const polygonVertex = object as {
      polygonVertex?: boolean;
      vertexIndex?: number;
      vertexTotal?: number;
      position?: [number, number];
    };
    if (polygonVertex.polygonVertex && polygonVertex.position) {
      return (
        <TooltipBox>
          <TooltipHeading
            title={layerInfo?.name ?? "Polygon"}
            subtitle="Polygon Vertex"
          />
          <TooltipProperties
            properties={[
              {
                label: "Vertex",
                value: `${polygonVertex.vertexIndex} of ${polygonVertex.vertexTotal}`,
              },
              // formatCoordinatePair honours the IGRS toggle, so a vertex reads the
              // same way as every other coordinate in this tooltip.
              {
                label: coordinateLabel,
                value: formatCoordinatePair(object.position),
              },
            ]}
          />
        </TooltipBox>
      );
    }

    if (object.position) {
      const properties = [];

      if (layerInfo?.radius || object.radius) {
        properties.push({
          label: "Radius",
          value: `${(layerInfo?.radius || object.radius).toLocaleString()} px`,
        });
      }

      properties.push({
        label: `Coordinates (${coordinateLabel})`,
        value: formatCoordinatePair(object.position),
      });

      return (
        <TooltipBox>
          {layerInfo?.name && (
            <TooltipHeading title={layerInfo.name} subtitle="Point" />
          )}
          <TooltipProperties properties={properties} />
        </TooltipBox>
      );
    }

    // Deck.gl PolygonLayer (custom data shape with `ring` from unkinked polygons)
    if (
      object.ring &&
      Array.isArray(object.ring) &&
      object.layer?.type === "polygon"
    ) {
      const ring = object.ring as [number, number][];
      // Prefer measurements computed on the full layer polygon to keep
      // consistency with the side panel and avoid per-ring variance.
      const areaMeters =
        (object as any).areaMeters ??
        computePolygonAreaMeters(layerInfo?.polygon ?? [ring]);
      const perimeterMeters =
        (object as any).perimeterMeters ??
        computePolygonPerimeterMeters(layerInfo?.polygon ?? [ring]);
      const vertexCount =
        (object as any).vertexCount ??
        (() => {
          let count = ring.length;
          if (
            count > 0 &&
            ring[0] &&
            ring[count - 1] &&
            Math.abs(ring[0][0] - ring[count - 1][0]) < 1e-10 &&
            Math.abs(ring[0][1] - ring[count - 1][1]) < 1e-10
          ) {
            count -= 1;
          }
          return count;
        })();

      const properties = [
        { label: "Area", value: formatArea(areaMeters) },
        { label: "Perimeter", value: formatDistance(perimeterMeters / 1000) },
        { label: "Vertices Drawn", value: String(vertexCount) },
      ];

      return (
        <TooltipBox>
          <TooltipHeading
            title={layerInfo?.name ?? "Polygon"}
            subtitle="Polygon"
          />
          <TooltipProperties properties={properties} />
        </TooltipBox>
      );
    }

    if (object.polygon) {
      // object.polygon from deck.gl PolygonLayer is a single ring [number, number][]
      // computePolygonAreaMeters expects [number, number][][] (array of rings), so wrap it
      const polygonRings =
        Array.isArray(object.polygon[0]) && Array.isArray(object.polygon[0][0])
          ? object.polygon // Already array of rings [[[lng, lat], ...], ...]
          : [object.polygon]; // Single ring [[lng, lat], ...], wrap it
      const areaMeters = computePolygonAreaMeters(polygonRings);
      const perimeterMeters = computePolygonPerimeterMeters(polygonRings);

      // Calculate actual vertex count (excluding closing point if polygon is closed)
      const polygonRing = object.polygon[0] || [];
      let vertexCount = polygonRing.length;
      // Check if polygon is closed (last point equals first point)
      if (
        vertexCount > 0 &&
        polygonRing[0] &&
        polygonRing[vertexCount - 1] &&
        Math.abs(polygonRing[0][0] - polygonRing[vertexCount - 1][0]) < 1e-10 &&
        Math.abs(polygonRing[0][1] - polygonRing[vertexCount - 1][1]) < 1e-10
      ) {
        vertexCount -= 1; // Subtract the closing point
      }

      const properties = [
        { label: "Area", value: formatArea(areaMeters) },
        {
          label: "Perimeter",
          value: formatDistance(perimeterMeters / 1000),
        },
        { label: "Drawn Points", value: String(vertexCount) },
      ];

      return (
        <TooltipBox>
          {layerInfo?.name && (
            <TooltipHeading title={layerInfo.name} subtitle="Polygon" />
          )}
          <TooltipProperties properties={properties} />
        </TooltipBox>
      );
    }

    // Deck.gl PathLayer line (object.path = [[lng, lat], ...]) — plain uploaded
    // lines and generated node/SNR connection lines. Without this branch these
    // fall through to the generic "Map Feature" placeholder below and, lacking a
    // geographic anchor, the tooltip also fails to follow the map on pan.
    if (
      Array.isArray(object.path) &&
      object.path.length >= 2 &&
      Array.isArray(object.path[0])
    ) {
      const path = object.path as [number, number][];
      let totalKm = 0;
      for (let i = 0; i < path.length - 1; i++) {
        totalKm += parseFloat(getDistance(path[i], path[i + 1]));
      }
      const from = path[0];
      const to = path[path.length - 1];

      const properties: { label: string; value: string }[] = [];
      const width = layerInfo?.lineWidth ?? object.width;
      if (width) {
        properties.push({ label: "Width", value: `${width} px` });
      }
      properties.push({
        label: "Distance",
        value: `${totalKm.toFixed(2)} km`,
      });
      properties.push(
        {
          label: `From (${coordinateLabel})`,
          value: formatCoordinatePair(from),
        },
        {
          label: `To (${coordinateLabel})`,
          value: formatCoordinatePair(to),
        },
      );

      return (
        <TooltipBox>
          {layerInfo?.name && (
            <TooltipHeading title={layerInfo.name} subtitle="Line" />
          )}
          <TooltipProperties properties={properties} />
        </TooltipBox>
      );
    }

    return (
      <TooltipBox>
        <TooltipHeading title="Map Feature" />
        <div className="text-gray-600" style={{ fontSize: "0.95em" }}>
          Hover for details
        </div>
      </TooltipBox>
    );
  };

  // Keep the tooltip fully on-screen. Default to the lower-right of the anchor,
  // but flip to the LEFT when a feature near the right edge would push it off, and
  // clamp so it never spills past any edge. Uses the measured box size.
  const viewportW = typeof window !== "undefined" ? window.innerWidth : 0;
  const viewportH = typeof window !== "undefined" ? window.innerHeight : 0;
  const edgeMargin = 8;
  const anchorGap = 12;
  // Only keep the box pinned on-screen while the ANCHOR is still visible. Once the
  // feature is panned off an edge (into the off-screen "dead" area), the tooltip
  // should travel WITH it rather than sticking to the edge — so the clamps below
  // are gated per axis on the anchor being on-screen. (At the exact edge the clamp
  // is already a no-op, so disabling it just past the edge is seamless.) The flip
  // stays unconditional, so a feature near — but still inside — the right edge
  // still opens leftward as before.
  const anchorOnScreenX = x >= 0 && x <= viewportW;
  const anchorOnScreenY = y >= 0 && y <= viewportH;
  let boxLeft = x + anchorGap;
  if (boxSize.w > 0 && boxLeft + boxSize.w > viewportW - edgeMargin) {
    boxLeft = x - anchorGap - boxSize.w; // open to the left of the anchor
  }
  if (anchorOnScreenX) {
    if (boxLeft < edgeMargin) boxLeft = edgeMargin;
    if (boxSize.w > 0 && boxLeft + boxSize.w > viewportW - edgeMargin) {
      boxLeft = Math.max(edgeMargin, viewportW - edgeMargin - boxSize.w);
    }
  }
  let boxTop = y - 10;
  if (anchorOnScreenY) {
    if (boxSize.h > 0 && boxTop + boxSize.h > viewportH - edgeMargin) {
      boxTop = viewportH - edgeMargin - boxSize.h;
    }
    if (boxTop < edgeMargin) boxTop = edgeMargin;
  }

  return (
    <div
      ref={tooltipBoxRef}
      style={{
        position: "absolute",
        left: boxLeft,
        top: boxTop,
        pointerEvents:
          layer?.id === "udp-network-members-layer" ||
          layer?.id === "udp-targets-layer" ||
          layer?.id === "udp-topology-nodes-layer"
            ? "auto"
            : "none",
        zIndex: 5,
      }}
    >
      {getTooltipContent()}
    </div>
  );
};

export default Tooltip;
