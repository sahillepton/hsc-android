import {
  formatArea,
  formatDistance,
  getDistance,
  formatLabel,
  calculateIgrs,
} from "@/lib/utils";
import {
  DEFAULT_LAYER_MAX_ZOOM,
  TOOLTIP_DEFAULT_ATTR_LIMIT,
} from "@/lib/constants";
import {
  normalizeAngleSigned,
  computePolygonPerimeterMeters,
  computePolygonAreaMeters,
} from "@/lib/layers";
import {
  useHoverInfo,
  useLayers,
  useIgrsPreference,
  useUserLocation,
} from "@/store/layers-store";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Video, Upload, MessageSquare, PhoneCall } from "lucide-react";
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
  getShortestRouteCoordinateSubtitle,
  SHORTEST_ROUTE_LAYER_PREFIX,
} from "@/lib/route-layer";
import { isSketchLayer } from "@/lib/sketch-layers";

const SHORTEST_ROUTE_TOOLTIP_HIDDEN_PROPS = new Set([
  "shortestRoute",
  "lineColor",
  "distanceMeters",
]);

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
  const { showUserLocation } = useUserLocation();
  const [coarsePointer, setCoarsePointer] = useState(() =>
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches,
  );
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function")
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
  const tooltipRafRef = useRef<number | null>(null);
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

        // Live topology node — follow UDP position between taps (pick snapshot is stale).
        if (
          deckLayerId === "udp-topology-nodes-layer" &&
          hoverInfo.object
        ) {
          const globalId = (hoverInfo.object as { globalId?: number }).globalId;
          const live =
            globalId !== undefined ? topologyNodes.get(globalId) : undefined;
          if (live) {
            lng = live.long;
            lat = live.lat;
          }
        }

        // PRIORITY 1: Always use hoverInfo.coordinate if available
        // This is the actual hovered point on the map (works for raster, LineString, etc.)
        // This is especially important for DEM/raster layers and LineString layers
        if (lng === undefined && lat === undefined && hoverInfo.coordinate && hoverInfo.coordinate.length >= 2) {
          [lng, lat] = hoverInfo.coordinate;
        }
        // PRIORITY 2: Try to get coordinates from object geometry (only if object exists)
        else if (lng === undefined && lat === undefined && hoverInfo.object?.geometry?.coordinates) {
          // GeoJSON Point
          if (
            Array.isArray(hoverInfo.object.geometry.coordinates) &&
            hoverInfo.object.geometry.coordinates.length >= 2 &&
            !Array.isArray(hoverInfo.object.geometry.coordinates[0])
          ) {
            lng = hoverInfo.object.geometry.coordinates[0];
            lat = hoverInfo.object.geometry.coordinates[1];
          } else if (
            hoverInfo.object.geometry.type === "Polygon" &&
            Array.isArray(hoverInfo.object.geometry.coordinates[0])
          ) {
            // Polygon - use first point of first ring as reference
            const firstRing = hoverInfo.object.geometry.coordinates[0];
            if (
              firstRing &&
              firstRing.length > 0 &&
              Array.isArray(firstRing[0])
            ) {
              lng = firstRing[0][0];
              lat = firstRing[0][1];
            }
          } else if (
            hoverInfo.object.geometry.type === "LineString" &&
            Array.isArray(hoverInfo.object.geometry.coordinates) &&
            hoverInfo.object.geometry.coordinates.length > 0 &&
            Array.isArray(hoverInfo.object.geometry.coordinates[0])
          ) {
            // LineString - use first point as fallback (coordinate should be handled above)
            const firstPoint = hoverInfo.object.geometry.coordinates[0];
            if (firstPoint && firstPoint.length >= 2) {
              lng = firstPoint[0];
              lat = firstPoint[1];
            }
          }
        }
        // PRIORITY 3: Direct polygon layer (only if object exists)
        else if (
          lng === undefined &&
          lat === undefined &&
          hoverInfo.object?.polygon &&
          Array.isArray(hoverInfo.object.polygon)
        ) {
          // Direct polygon layer - use first point as reference
          const firstRing =
            Array.isArray(hoverInfo.object.polygon[0]) &&
            Array.isArray(hoverInfo.object.polygon[0][0])
              ? hoverInfo.object.polygon[0] // Array of rings
              : hoverInfo.object.polygon; // Single ring
          if (
            firstRing &&
            firstRing.length > 0 &&
            Array.isArray(firstRing[0])
          ) {
            lng = firstRing[0][0];
            lat = firstRing[0][1];
          }
        }
        // PRIORITY 4: Direct coordinates from object (only if object exists)
        else if (
          lng === undefined &&
          lat === undefined &&
          hoverInfo.object?.longitude !== undefined &&
          hoverInfo.object?.latitude !== undefined
        ) {
          // Direct coordinates
          lng = hoverInfo.object.longitude;
          lat = hoverInfo.object.latitude;
        }
        // PRIORITY 5: Position array (only if object exists)
        else if (
          lng === undefined &&
          lat === undefined &&
          hoverInfo.object?.position &&
          Array.isArray(hoverInfo.object.position)
        ) {
          // Position array [lng, lat]
          lng = hoverInfo.object.position[0];
          lat = hoverInfo.object.position[1];
        }
        // PRIORITY 6: deck LineLayer segment (source/target) — anchor at midpoint
        else if (
          lng === undefined &&
          lat === undefined &&
          Array.isArray(hoverInfo.object?.sourcePosition) &&
          Array.isArray(hoverInfo.object?.targetPosition)
        ) {
          const s = hoverInfo.object.sourcePosition;
          const t = hoverInfo.object.targetPosition;
          lng = (s[0] + t[0]) / 2;
          lat = (s[1] + t[1]) / 2;
        }
        // PRIORITY 7: deck PathLayer line (object.path) — anchor at midpoint vertex
        else if (
          lng === undefined &&
          lat === undefined &&
          Array.isArray(hoverInfo.object?.path) &&
          hoverInfo.object.path.length > 0
        ) {
          const pathPts = hoverInfo.object.path;
          const mid = pathPts[Math.floor(pathPts.length / 2)];
          if (Array.isArray(mid) && mid.length >= 2) {
            lng = mid[0];
            lat = mid[1];
          }
        }

        if (lng !== undefined && lat !== undefined) {
          if (isGeodetic) {
            // Project through the geodetic view's live camera (exposed on window
            // by GeodeticBasemapView). Fall back to the pick pixel if unavailable.
            const project = (
              window as unknown as {
                __geodeticProject?: (
                  lng: number,
                  lat: number,
                ) => { x: number; y: number };
              }
            ).__geodeticProject;
            const p = project?.(lng, lat);
            if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) {
              setPositionSafely(p.x, p.y);
            } else {
              setPositionSafely(hoverInfo.x || 0, hoverInfo.y || 0);
            }
          } else {
            // Project geographic coordinates to screen coordinates
            const point = map.project([lng, lat]);
            setPositionSafely(point.x, point.y);
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

    // Listen to map move events
    const map = mapRef.current?.getMap();
    if (map) {
      // Get initial zoom
      const initialZoom = map.getZoom();
      setMapZoom(initialZoom);

      const schedulePositionUpdate = () => {
        if (tooltipRafRef.current !== null) return;
        tooltipRafRef.current = requestAnimationFrame(() => {
          tooltipRafRef.current = null;
          updatePosition();
        });
      };

      const handleZoom = () => {
        const zoom = map.getZoom();
        setMapZoom((prev) =>
          prev === null || Math.abs(prev - zoom) >= 0.01 ? zoom : prev,
        );
        schedulePositionUpdate();
      };

      map.on("move", schedulePositionUpdate);
      map.on("zoom", handleZoom);
      // The geodetic view's camera is not the mapbox map, so its pan/zoom arrives
      // as a window event (dispatched by GeodeticBasemapView). Re-project on it too.
      window.addEventListener("geodetic-view-change", schedulePositionUpdate);

      return () => {
        if (tooltipRafRef.current !== null) {
          cancelAnimationFrame(tooltipRafRef.current);
          tooltipRafRef.current = null;
        }
        map.off("move", schedulePositionUpdate);
        map.off("zoom", handleZoom);
        window.removeEventListener("geodetic-view-change", schedulePositionUpdate);
      };
    }
  }, [hoverInfo, mapRef, layers, topologyNodes]);

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
  // Check if the object is a LayerProps itself (for point/polygon layers)
  else if ((object as any)?.id && (object as any)?.type) {
    layerInfo = layers.find((l) => l.id === (object as any).id);
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

  // Check if layer is outside its zoom range. Hand-drawn sketches are never
  // zoom-gated (they render at every zoom), so their tooltip must not be gated
  // either — otherwise an existing sketch that still carries a stale stored
  // minzoom would render on the map but show no tooltip at low zoom.
  if (layerInfo && mapZoom !== null && !isSketchLayer(layerInfo)) {
    const effectiveZoom = Math.floor(mapZoom);
    const minZoomCheck =
      layerInfo.minzoom === undefined || effectiveZoom >= layerInfo.minzoom;
    const maxZoomCheck =
      effectiveZoom <= (layerInfo.maxzoom ?? DEFAULT_LAYER_MAX_ZOOM);
    if (!minZoomCheck || !maxZoomCheck) {
      return null;
    }
  }

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

      let lng: number | undefined;
      let lat: number | undefined;

      if (hoverInfo.coordinate) {
        [lng, lat] = hoverInfo.coordinate;
      } else if (
        (object as any)?.position &&
        Array.isArray((object as any).position)
      ) {
        [lng, lat] = (object as any).position;
      }

      return (
        <TooltipBox>
          <TooltipHeading title="Your Location" />
          {lng !== undefined && lat !== undefined && (
            <TooltipProperties
              properties={[
                {
                  label: coordinateLabel,
                  value: formatCoordinatePair([lng, lat]),
                },
              ]}
            />
          )}
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
      if (!hasValue && !loading) {
        return null;
      }

      const properties = [
        {
          label: useIgrs ? "IGRS" : "Latitude",
          value: useIgrs
            ? (calculateIgrs(lng, lat) ?? "—")
            : `${lat.toFixed(6)}°`,
        },
      ];
      if (!useIgrs) {
        properties.push({ label: "Longitude", value: `${lng.toFixed(6)}°` });
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

      properties.push({
        label: valueLabel,
        value: valueStr,
      });
      if (typeof min === "number" && typeof max === "number") {
        properties.push({
          label: "Range",
          value: `${min.toFixed(2)} – ${max.toFixed(2)}`,
        });
      }
      if (layerInfo.sourceCrs) {
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

          const properties = [
            {
              label: useIgrs ? "IGRS" : "Latitude",
              value: useIgrs
                ? (calculateIgrs(lng, lat) ?? "—")
                : `${lat.toFixed(6)}°`,
            },
          ];

          if (!useIgrs) {
            properties.push({
              label: "Longitude",
              value: `${lng.toFixed(6)}°`,
            });
          }

          properties.push(
            { label: "Pixel Index", value: `(${x}, ${y})` },
            {
              label: "Elevation",
              value: hasValidElevation
                ? `${elevation.toFixed(2)} m`
                : "No data",
            },
            {
              label: "Elevation Range",
              value: `${min.toFixed(1)}–${max.toFixed(1)} m`,
            },
            {
              label: "Raster Size",
              value: `${width} × ${height} px`,
            },
          );

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
          value: `${Number(object.altitude).toFixed(0)} m`,
        });
      }

      const displayProperties = Object.entries(object)
        .filter(
          ([key, value]) =>
            importantKeys.includes(key) &&
            !(
              layer.id === "udp-topology-nodes-layer" && key === "altitude"
            ) &&
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
        action: "video" | "ftp" | "call" | "message",
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
                  ? "Topology Node"
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
                {[0, 1, 2, 3].map((i) => (
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
      let angleDeg = isNorthSegment
        ? 0
        : normalizeAngleSigned(layerInfo.azimuthAngleDeg ?? 0);
      if (angleDeg === -180) angleDeg = 180;
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
            title="Bearing Calculation"
            subtitle={layerInfo?.name}
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

      const isShortestRoute =
        !!layerInfo && isShortestRouteLayer(layerInfo);

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

      if (geometryType === "Point" && object.geometry.coordinates) {
        tooltipProperties.push({
          label: `Coordinates (${coordinateLabel})`,
          value: formatCoordinatePair(
            object.geometry.coordinates as [number, number],
          ),
        });
      }

      // Feature attribute rows. Two modes:
      //  • No selection yet (undefined): show only meaningful values, alphabetically,
      //    capped — a compact, well-positioned default for big-schema features.
      //  • Explicit selection (array, from the layer's "Tooltip Attributes" panel):
      //    AUTHORITATIVE — show EXACTLY the ticked keys, in full, no cap, and render
      //    a ticked-but-empty/absent field as "—" so "ticked = shown" always holds
      //    (e.g. a field that exists on other features but is blank on this one).
      const attrWhitelist = layerInfo?.tooltipAttributes;
      let hiddenAttrCount = 0;
      if (attrWhitelist === undefined) {
        const meaningful = Object.entries(properties)
          .filter(
            ([key, value]) =>
              isMeaningfulPropertyValue(value) &&
              !(isShortestRoute && SHORTEST_ROUTE_TOOLTIP_HIDDEN_PROPS.has(key)),
          )
          .sort(([a], [b]) => a.localeCompare(b));
        const shown = meaningful.slice(0, TOOLTIP_DEFAULT_ATTR_LIMIT);
        hiddenAttrCount = meaningful.length - shown.length;
        shown.forEach(([key, value]) => {
          tooltipProperties.push({
            label: formatAttributeLabel(key),
            value: formatTooltipValue(key, value),
          });
        });
      } else {
        [...attrWhitelist]
          .filter(
            (key) =>
              !(isShortestRoute && SHORTEST_ROUTE_TOOLTIP_HIDDEN_PROPS.has(key)),
          )
          .sort((a, b) => a.localeCompare(b))
          .slice(0, TOOLTIP_DEFAULT_ATTR_LIMIT) // hard cap, mirrors the panel limit
          .forEach((key) => {
            const value = (properties as Record<string, unknown>)[key];
            tooltipProperties.push({
              label: formatAttributeLabel(key),
              value: isMeaningfulPropertyValue(value)
                ? formatTooltipValue(key, value)
                : "—",
            });
          });
      }

      const useGridLayout = tooltipProperties.length > 10;

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
              title={
                isShortestRoute
                  ? SHORTEST_ROUTE_LAYER_PREFIX
                  : layerInfo.name
              }
              subtitle={
                isShortestRoute
                  ? (getShortestRouteCoordinateSubtitle(layerInfo) ??
                    `${geometryType} Feature`)
                  : `${geometryType} Feature`
              }
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
