import { useState, useEffect, useRef, useCallback, useTransition } from "react";
import {
  X,
  Route,
  MapPin,
  Loader2,
  AlertCircle,
  CheckCircle2,
  LocateFixed,
  EyeIcon,
  EyeOffIcon,
  ArrowUp,
  Settings2,
} from "lucide-react";
import { Button } from "../ui/button";
import {
  computeRouteSnapToleranceMeters,
  routeMaxSnapDistanceMeters,
} from "@/lib/route-params";
import {
  useLayers,
  useFocusLayerRequest,
  useHoverInfo,
  useIgrsPreference,
} from "@/store/layers-store";
import { isShortestRouteLayer } from "@/lib/route-layer";
import type { LayerProps } from "@/lib/definitions";
import { cn, calculateIgrs } from "@/lib/utils";
import { toast } from "@/lib/toast";
import LayerPopover from "../app-sidebar/layer-popover";

/** Collect LineString / MultiLineString pieces (including inside GeometryCollection). */
function lineGeometriesFromGeometry(
  geom: GeoJSON.Geometry | null | undefined,
): Array<GeoJSON.LineString | GeoJSON.MultiLineString> {
  if (!geom) return [];
  switch (geom.type) {
    case "LineString":
    case "MultiLineString":
      return [geom];
    case "GeometryCollection": {
      const out: Array<GeoJSON.LineString | GeoJSON.MultiLineString> = [];
      for (const g of geom.geometries ?? []) {
        out.push(...lineGeometriesFromGeometry(g));
      }
      return out;
    }
    default:
      return [];
  }
}

function isRouteableLayer(layer: LayerProps): boolean {
  if (isShortestRouteLayer(layer)) return false;
  if (layer.type === "geojson" && layer.geojson) {
    return layer.geojson.features.some(
      (f) => lineGeometriesFromGeometry(f.geometry).length > 0,
    );
  }
  return false;
}

function extractLineFeatures(
  layer: LayerProps,
): GeoJSON.FeatureCollection | null {
  if (layer.type !== "geojson" || !layer.geojson) return null;

  const features: GeoJSON.Feature[] = [];
  for (const f of layer.geojson.features) {
    const props = f.properties ?? {};
    for (const g of lineGeometriesFromGeometry(f.geometry)) {
      features.push({
        type: "Feature",
        geometry: g,
        properties: props,
      });
    }
  }
  if (features.length === 0) return null;
  return { type: "FeatureCollection", features };
}

function getLineFeatureCount(layer: LayerProps): number {
  if (layer.type === "geojson" && layer.geojson) {
    return layer.geojson.features.reduce(
      (acc, f) => acc + lineGeometriesFromGeometry(f.geometry).length,
      0,
    );
  }
  return 0;
}

export interface RouteToolState {
  selectedLayerId: string | null;
  graphReady: boolean;
  graphBuilding: boolean;
  buildProgress: string;
  nodeCount: number;
  edgeCount: number;
  pointA: [number, number] | null;
  pointB: [number, number] | null;
  snappedA: [number, number] | null;
  snappedB: [number, number] | null;
  pickMode: "A" | "B" | null;
  pathResult: {
    path: [number, number][];
    dist: number;
    segments: number;
  } | null;
  error: string | null;
}

export const initialRouteToolState: RouteToolState = {
  selectedLayerId: null,
  graphReady: false,
  graphBuilding: false,
  buildProgress: "",
  nodeCount: 0,
  edgeCount: 0,
  pointA: null,
  pointB: null,
  snappedA: null,
  snappedB: null,
  pickMode: "A",
  pathResult: null,
  error: null,
};

interface RouteBoxProps {
  onClose: () => void;
  routeState: RouteToolState;
  setRouteState: React.Dispatch<React.SetStateAction<RouteToolState>>;
  workerRef: React.MutableRefObject<Worker | null>;
  /** Current map zoom; used so click-snap max distance scales with m/px. */
  mapZoom: number;
}

const RouteBox = ({
  onClose,
  routeState,
  setRouteState,
  workerRef,
  mapZoom,
}: RouteBoxProps) => {
  const mapZoomRef = useRef(mapZoom);
  mapZoomRef.current = mapZoom;

  const { layers, bringLayerToTop } = useLayers();
  const { focusLayer, updateLayer } = useFocusLayerRequest();
  const { hoverInfo, setHoverInfo } = useHoverInfo();
  const useIgrs = useIgrsPreference();
  const routeableLayers = layers.filter(isRouteableLayer);
  const [focusedLayerId, setFocusedLayerId] = useState<string | null>(null);
  const [algo, setAlgo] = useState<"dijkstra" | "astar">("astar");
  const [, startTransition] = useTransition();

  const formatCoord = useCallback(
    (point: [number, number] | null): string => {
      if (!point) return "Click map";
      if (useIgrs) {
        const igrs = calculateIgrs(point[0], point[1]);
        if (igrs) return igrs;
      }
      return `${point[1].toFixed(6)}°, ${point[0].toFixed(6)}°`;
    },
    [useIgrs],
  );

  const selectedLayer = routeState.selectedLayerId
    ? layers.find((l) => l.id === routeState.selectedLayerId)
    : null;

  const handleSelectLayer = useCallback(
    (layerId: string) => {
      const layer = layers.find((l) => l.id === layerId);
      if (!layer) return;

      const geojson = extractLineFeatures(layer);
      if (!geojson) return;

      setRouteState(() => ({
        ...initialRouteToolState,
        selectedLayerId: layerId,
        graphBuilding: true,
        buildProgress: "Initializing…",
        pickMode: "A",
      }));

      if (workerRef.current) {
        workerRef.current.terminate();
      }

      const worker = new Worker(
        new URL("../../workers/dijkstra-worker.ts", import.meta.url),
        { type: "module" },
      );
      workerRef.current = worker;

      worker.onmessage = (e: MessageEvent) => {
        const msg = e.data;
        switch (msg.type) {
          case "progress":
            setRouteState((prev) => ({
              ...prev,
              buildProgress: msg.message,
            }));
            break;
          case "graph-built":
            if (msg.error) {
              setRouteState((prev) => ({
                ...prev,
                graphBuilding: false,
                graphReady: false,
                error: msg.error,
              }));
            } else {
              setRouteState((prev) => ({
                ...prev,
                graphBuilding: false,
                graphReady: true,
                nodeCount: msg.nodeCount,
                edgeCount: msg.edgeCount,
                error: null,
              }));
            }
            break;
          case "snap-result": {
            if (msg.error) break;
            const latSnap =
              typeof msg.snapped?.[1] === "number" ? msg.snapped[1] : 0;
            const maxSnapM = routeMaxSnapDistanceMeters(
              mapZoomRef.current,
              latSnap,
            );
            if (msg.dist > maxSnapM) {
              toast.error("Click on the selected layer");
              setRouteState((prev) => {
                if (msg.tag === "A") {
                  return { ...prev, pointA: null, snappedA: null, pickMode: "A" };
                }
                return { ...prev, pointB: null, snappedB: null, pickMode: "B" };
              });
              break;
            }
            setRouteState((prev) => {
              if (msg.tag === "A") {
                if (!prev.pointA) return prev;
                return { ...prev, snappedA: msg.snapped };
              } else {
                if (!prev.pointB) return prev;
                return { ...prev, snappedB: msg.snapped };
              }
            });
            break;
          }
          case "path-result":
            setRouteState((prev) => {
              if (!prev.pointA || !prev.pointB) return prev;
              if (msg.error) {
                return { ...prev, error: msg.error, pathResult: null };
              }
              return {
                ...prev,
                pathResult: {
                  path: msg.path,
                  dist: msg.dist,
                  segments: msg.segments,
                },
                error: null,
              };
            });
            break;
        }
      };

      worker.onerror = (err) => {
        setRouteState((prev) => ({
          ...prev,
          graphBuilding: false,
          error: "Worker error: " + (err.message || "Unknown error"),
        }));
      };

      const snapTolMeters = computeRouteSnapToleranceMeters(geojson);
      worker.postMessage({
        type: "build-graph",
        geojson,
        snapTolMeters,
      });
    },
    [layers, setRouteState, workerRef],
  );

  const handleFindPath = useCallback(() => {
    if (
      !workerRef.current ||
      !routeState.graphReady ||
      !routeState.pointA ||
      !routeState.pointB
    )
      return;
    setRouteState((prev) => ({ ...prev, error: null }));
    workerRef.current.postMessage({
      type: "find-path",
      startLonLat: routeState.pointA,
      endLonLat: routeState.pointB,
      algo,
    });
  }, [
    workerRef,
    routeState.graphReady,
    routeState.pointA,
    routeState.pointB,
    setRouteState,
    algo,
  ]);

  const prevPointsRef = useRef<string>("");
  useEffect(() => {
    const key = `${routeState.pointA?.join(",") ?? ""}-${routeState.pointB?.join(",") ?? ""}`;
    if (
      key !== prevPointsRef.current &&
      routeState.pointA &&
      routeState.pointB &&
      routeState.graphReady
    ) {
      prevPointsRef.current = key;
      handleFindPath();
    }
  }, [
    routeState.pointA,
    routeState.pointB,
    routeState.graphReady,
    handleFindPath,
  ]);

  const prevAlgoRef = useRef(algo);
  useEffect(() => {
    if (
      prevAlgoRef.current !== algo &&
      routeState.pointA &&
      routeState.pointB &&
      routeState.graphReady
    ) {
      prevAlgoRef.current = algo;
      handleFindPath();
    }
  }, [algo, routeState.pointA, routeState.pointB, routeState.graphReady, handleFindPath]);

  const handleToggleVisibility = useCallback(
    (layerId: string) => {
      const layer = layers.find((l) => l.id === layerId);
      if (!layer) return;
      const newVisible = layer.visible === false;
      updateLayer(layerId, { ...layer, visible: newVisible });
      if (!newVisible && hoverInfo) {
        setHoverInfo(undefined);
      }
    },
    [layers, updateLayer, hoverInfo, setHoverInfo],
  );

  const formatDist = (meters: number) => {
    if (meters < 1000) return `${meters.toFixed(0)} m`;
    return `${(meters / 1000).toFixed(2)} km`;
  };

  const hasActiveLayer = routeState.selectedLayerId && selectedLayer;

  return (
    <>
      {/* ─── LEFT PANEL: Layer List (top-left) ─────────────────────────── */}
      <div
        style={{ zoom: 0.9 }}
        className="panel-scrollbar absolute top-4 left-4 z-50 flex w-[340px] max-h-[calc(100vh-120px)] flex-col rounded-lg border border-border/70 bg-card shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 shrink-0">
          <p className="flex items-center gap-3 text-base font-medium text-foreground">
            <Route className="size-5" />
            Route Finder
          </p>
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted"
            onClick={onClose}
            aria-label="Close route panel"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Layer cards */}
        <div className="px-3 pb-3 flex-1 overflow-y-auto">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Line Layers
          </p>
          {routeableLayers.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/60 bg-muted/30 p-4 text-center">
              <p className="text-xs text-muted-foreground">
                No line layers found. Upload a GeoJSON or Shapefile with road
                network data.
              </p>
            </div>
          ) : (
            routeableLayers.map((layer) => {
              const isSelected = routeState.selectedLayerId === layer.id;
              const isFocused = focusedLayerId === layer.id;
              const lineCount = getLineFeatureCount(layer);
              return (
                <div key={layer.id} className="mb-3">
                  <div
                    className={cn(
                      "relative rounded-2xl border border-border/60 bg-white/90 p-4 shadow-sm cursor-pointer transition-all",
                      isSelected && "border-l-4 border-l-blue-500",
                      isFocused && !isSelected && "border-l-4 border-l-sky-300",
                    )}
                    onClick={() => {
                      if (routeState.selectedLayerId !== layer.id) {
                        handleSelectLayer(layer.id);
                      }
                    }}
                  >
                    <div className="absolute right-3 top-3 flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        title={`Bring to top: ${layer.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          bringLayerToTop(layer.id);
                        }}
                      >
                        <ArrowUp size={10} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        title={`Focus & route: ${layer.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setFocusedLayerId(layer.id);
                          focusLayer(layer.id);
                          if (routeState.selectedLayerId !== layer.id) {
                            handleSelectLayer(layer.id);
                          }
                        }}
                      >
                        <LocateFixed size={10} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        title={
                          layer.visible === false
                            ? `Show layer: ${layer.name}`
                            : `Hide layer: ${layer.name}`
                        }
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleVisibility(layer.id);
                        }}
                      >
                        {layer.visible !== false ? (
                          <EyeIcon size={10} />
                        ) : (
                          <EyeOffIcon size={10} />
                        )}
                      </Button>
                      <LayerPopover layer={layer} updateLayer={updateLayer}>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          title={`Layer settings: ${layer.name}`}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Settings2 size={10} />
                        </Button>
                      </LayerPopover>
                    </div>

                    <div className="min-w-0 pr-28">
                      <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground mb-2">
                        <span className="truncate text-[16px] max-w-[160px] overflow-hidden text-ellipsis">
                          {layer.name}
                          <span className="text-[10px] ml-2 font-semibold uppercase tracking-wide text-blue-600">
                            geojson
                          </span>
                        </span>
                      </div>
                      <p className="text-[10px] text-muted-foreground">
                        {`${lineCount} line feature${lineCount !== 1 ? "s" : ""}`}
                      </p>
                    </div>

                    {isSelected && routeState.graphBuilding && (
                      <div className="mt-3 flex items-center gap-1.5">
                        <Loader2 className="h-3 w-3 animate-spin text-blue-500 shrink-0" />
                        <p className="text-[10px] text-blue-600 truncate">
                          {routeState.buildProgress}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ─── RIGHT PANEL: Route Controls (top-right) ──────────────────── */}
      {hasActiveLayer && (
        <div
          style={{ zoom: 0.9 }}
          className="panel-scrollbar absolute top-16 right-2 z-50 flex w-[264px] flex-col rounded-lg border border-border/70 bg-card shadow-2xl overflow-y-auto"
        >
          <div
            className="px-3 py-3 space-y-3"
            style={{ maxHeight: "min(480px, calc(100vh - 160px))" }}
          >
            {/* Graph Building Status */}
            {routeState.graphBuilding && (
              <div className="flex items-center gap-2 rounded-lg bg-blue-50/80 border border-blue-200/50 px-3 py-2">
                <Loader2 className="h-4 w-4 animate-spin text-blue-500 shrink-0" />
                <p className="text-xs text-blue-700">
                  {routeState.buildProgress}
                </p>
              </div>
            )}

            {/* Algorithm Toggle */}
            {routeState.graphReady && (
              <div>
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                  Algorithm
                </p>
                <div className="flex rounded-lg border border-border/60 bg-muted/30 p-0.5 gap-0.5">
                  <button
                    onClick={() => startTransition(() => setAlgo("astar"))}
                    className={cn(
                      "flex-1 rounded-md px-2 py-1.5 text-xs font-medium font-mono transition-all",
                      algo === "astar"
                        ? "bg-violet-500 text-white shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    A*
                  </button>
                  <button
                    onClick={() => startTransition(() => setAlgo("dijkstra"))}
                    className={cn(
                      "flex-1 rounded-md px-2 py-1.5 text-xs font-medium font-mono transition-all",
                      algo === "dijkstra"
                        ? "bg-blue-500 text-white shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    Dijkstra
                  </button>
                </div>
                <p className="text-[10px] text-muted-foreground mt-1 leading-relaxed">
                  {algo === "astar"
                    ? "A* — heuristic-guided, faster on large networks."
                    : "Dijkstra — no heuristic, guarantees true shortest path."}
                </p>
              </div>
            )}

            {/* Point Selection */}
            {routeState.graphReady && (
              <>
                <div>
                  <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                    Select Points
                  </p>
                  <div className="flex gap-2 mb-2">
                    <button
                      onClick={() =>
                        setRouteState((prev) => ({ ...prev, pickMode: "A" }))
                      }
                      className={cn(
                        "flex-1 flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-xs font-medium transition-all",
                        routeState.pickMode === "A"
                          ? "border-green-400 bg-green-50 text-green-700"
                          : "border-border/60 bg-white text-muted-foreground hover:border-green-300",
                      )}
                    >
                      <MapPin className="h-3 w-3" />
                      Start (A)
                    </button>
                    <button
                      onClick={() =>
                        setRouteState((prev) => ({ ...prev, pickMode: "B" }))
                      }
                      className={cn(
                        "flex-1 flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-xs font-medium transition-all",
                        routeState.pickMode === "B"
                          ? "border-red-400 bg-red-50 text-red-700"
                          : "border-border/60 bg-white text-muted-foreground hover:border-red-300",
                      )}
                    >
                      <MapPin className="h-3 w-3" />
                      End (B)
                    </button>
                  </div>

                  {/* Point coordinates */}
                  <div className="space-y-1 text-[11px]">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
                      <span className="text-muted-foreground">A:</span>
                      <span className="font-mono text-foreground truncate">
                        {formatCoord(routeState.snappedA)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
                      <span className="text-muted-foreground">B:</span>
                      <span className="font-mono text-foreground truncate">
                        {formatCoord(routeState.snappedB)}
                      </span>
                    </div>
                  </div>
                </div>

              </>
            )}

            {/* Error */}
            {routeState.error && (
              <div className="flex items-start gap-2 rounded-lg bg-red-50/80 border border-red-200/50 px-3 py-2">
                <AlertCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
                <p className="text-xs text-red-700">{routeState.error}</p>
              </div>
            )}

            {/* Results */}
            {routeState.pathResult && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  <p className="text-[11px] font-semibold text-green-700 uppercase tracking-wider">
                    Path Found
                  </p>
                </div>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
                  <div className="flex flex-col rounded-lg bg-muted/40 border border-border/40 px-3 py-2">
                    <dt className="text-[10px] text-muted-foreground uppercase">
                      Distance
                    </dt>
                    <dd className="text-sm font-semibold font-mono text-foreground">
                      {formatDist(routeState.pathResult.dist)}
                    </dd>
                  </div>
                  <div className="flex flex-col rounded-lg bg-muted/40 border border-border/40 px-3 py-2">
                    <dt className="text-[10px] text-muted-foreground uppercase">
                      Segments
                    </dt>
                    <dd className="text-sm font-semibold font-mono text-foreground">
                      {routeState.pathResult.segments.toLocaleString()}
                    </dd>
                  </div>
                </dl>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
};

export default RouteBox;
