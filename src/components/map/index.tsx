import Map, { useControl, NavigationControl } from "react-map-gl/mapbox";
import { MapboxOverlay } from "@deck.gl/mapbox";
import type { PickingInfo } from "@deck.gl/core";
import {
  BitmapLayer,
  GeoJsonLayer,
  IconLayer,
  LineLayer,
  PathLayer,
  PolygonLayer,
  ScatterplotLayer,
  TextLayer,
} from "@deck.gl/layers";
import unkinkPolygon from "@turf/unkink-polygon";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import "mapbox-gl/dist/mapbox-gl.css";
import IconSelection from "./icon-selection";
import MeasurementBox from "./measurement-box";
import NetworkBox from "./network-box";
import RouteBox, {
  type RouteToolState,
  initialRouteToolState,
} from "./route-box";
import ZoomControls from "./zoom-controls";
import Tooltip from "./tooltip";
import { useUdpLayers } from "./udp-layers";
import { useUdpDataStore } from "@/store/udp-data-store";
// import UdpConfigDialog from "./udp-config-dialog"; // Removed: port is now fixed at 40074
import OfflineLocationTracker from "./offline-location-tracker";
import { initializeTileServer } from "./tile-folder-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../ui/dialog";
import {
  useRubberBandRectangle,
  useRubberBandOverlay,
  calculateRectangleBounds,
} from "./rubber-band-overlay";
// import { useUdpConfigStore } from "@/store/udp-config-store"; // Removed: port is now fixed at 40074
// import { useDefaultLayers } from "@/hooks/use-default-layers";
import {
  useCurrentPath,
  useDragStart,
  useDrawingMode,
  useFocusLayerRequest,
  useIsDrawing,
  useLayers,
  useMousePosition,
  useNetworkLayersVisible,
  useHoverInfo,
  usePendingPolygon,
  useIgrsPreference,
  useSetIgrsPreference,
  useUserLocation,
} from "@/store/layers-store";
import {
  calculateBearingDegrees,
  calculateDistanceMeters,
  destinationPoint,
  generateLayerId,
  isPointNearFirstPoint,
  getPolygonCloseThreshold,
  normalizeAngleSigned,
  computePolygonAreaMeters,
  computePolygonPerimeterMeters,
  calculateLayerZoomRange,
  isStoreLayerPickObject,
} from "@/lib/layers";
import {
  formatArea,
  formatDistance,
  shpToGeoJSON,
  // fileToGeoJSON,
  // fileToDEMRaster,
  // generateRandomColor,
} from "@/lib/utils";
import type { LayerProps } from "@/lib/definitions";
import { isSketchLayer } from "@/lib/sketch-layers";
import { toast } from "@/lib/toast";
import { NativeUploader } from "@/plugins/native-uploader";
import { Geolocation } from "@capacitor/geolocation";
import { ZipFolder } from "@/plugins/zip-folder";
import { Screenshot } from "@/plugins/screenshot";
import { Capacitor } from "@capacitor/core";
import { stagedPathToFile } from "@/utils/stagedPathToFile";
import { MAX_UPLOAD_FILES, getHscFilesDir } from "@/sessions/constants";
import {
  UDP_PORT,
  MAPBOX_ACCESS_TOKEN,
  DEFAULT_CENTER,
  DEFAULT_ZOOM,
  INITIAL_MAP_ZOOM,
  GEOLOCATION_ZOOM,
  MAP_MIN_ZOOM,
  MAP_MAX_ZOOM,
  MAP_MAX_PITCH,
  MAX_MERCATOR_LATITUDE,
  TILE_SOURCE_MAX_NATIVE_ZOOM,
  ANDROID_TILES_PATH,
  ANDROID_SCREENSHOTS_PATH,
  TILES_FOLDER_NAME,
  STORAGE_PERMISSION_TIMEOUT_MS,
  DEFAULT_LAYER_MAX_ZOOM,
} from "@/lib/constants";
import {
  upsertManifestEntry,
  finalizeSaveManifest,
  type ManifestEntry,
} from "@/sessions/manifestStore";
import {
  parseDemFile,
  createDemLayer,
  parseVectorFile,
  createVectorLayer,
} from "@/utils/parser";
import { generateRandomColor } from "@/lib/utils";
import { shouldTile } from "@/lib/tiling/threshold";
import {
  nextShortestRouteName,
  persistShortestRouteToSession,
} from "@/lib/route-layer";
import { runTilingUpload } from "@/lib/tiling/upload";
import {
  addOrUpdateTiledRaster,
  applyTiledRasterViewportCulling,
  pruneOrphanTiledRasters,
  removeTiledRaster,
} from "@/lib/tiling/render";
import { waitForRasterTilesLoaded } from "@/lib/tiling/wait-for-tiles";
import { RasterTiling } from "@/plugins/raster-tiling";
import { Settings, Pencil, Loader2 as Loader2Icon } from "lucide-react";
import { OfflineTileServer } from "@/plugins/offline-tile-server";
import {
  useBasemapStore,
  useActiveBasemapSource,
  basemapLabelFromPath,
} from "@/lib/basemap/basemapStore";
import {
  classifyTiles,
  resolveTilesConfig,
  type TilesConfig,
} from "@/lib/basemap/tileConfig";
import { mapboxZoomToOrtho, orthoZoomToMapbox } from "@/lib/basemap/tileGrid";
import GeodeticBasemapView from "./geodetic-basemap-view";
import type { ElectronAPI } from "@/electron";
import type { StyleSpecification } from "mapbox-gl";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

/** Last path segment, lowercased (handles Windows `\\` and nested zip paths). */
function fileBasenameLower(fileName: string): string {
  const normalized = fileName.replace(/\\/g, "/");
  return (normalized.split("/").pop() ?? normalized).toLowerCase();
}

/**
 * Last DEM in `layers` order under lng/lat = topmost raster in the Deck stack.
 *
 * Takes the zoom-visibility PREDICATE rather than a zoom number so it asks exactly
 * the same question the renderer does. It used to re-derive the min/max range and
 * compare `Math.floor(mapZoom)`, which drifted from `getZoomVisibility` (2-decimal
 * debounced zoom) — so a raster could be off-screen yet still pickable, or vice
 * versa, and its tooltip would open for a layer that was not drawn.
 */
function resolveTopmostDemUnderLngLat(
  layers: LayerProps[],
  isZoomVisible: (layer: LayerProps) => boolean,
  lng: number,
  lat: number,
): LayerProps | null {
  let top: LayerProps | null = null;
  for (const layer of layers) {
    if (layer.type !== "dem" || layer.visible === false || !layer.bounds) {
      continue;
    }
    if (!isZoomVisible(layer)) continue;
    const [[minLng, minLat], [maxLng, maxLat]] = layer.bounds;
    if (lng < minLng || lng > maxLng || lat < minLat || lat > maxLat) continue;
    top = layer;
  }
  return top;
}

/** Blue location-pin SVG (data URI) used for the "Your Location" marker. */
const USER_LOCATION_ICON_URL =
  "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTEyIDJDNy41ODIgMiA0IDUuNTgyIDQgMTBDNCAxNi4wODggMTIgMjIgMTIgMjJDMTIgMjIgMjAgMTYuMDg4IDIwIDEwQzIwIDUuNTgyIDE2LjQxOCAyIDEyIDJaIiBmaWxsPSIjM0I4MkY2IiBzdHJva2U9IndoaXRlIiBzdHJva2Utd2lkdGg9IjIiLz4KPGNpcmNsZSBjeD0iMTIiIGN5PSIxMCIgcj0iMyIgZmlsbD0id2hpdGUiLz4KPC9zdmc+";

function syntheticDemPickingInfo(
  dem: LayerProps,
  lng: number,
  lat: number,
  px: number,
  py: number,
): PickingInfo<unknown> {
  return {
    layer: { id: `${dem.id}-bitmap` } as PickingInfo<unknown>["layer"],
    coordinate: [lng, lat],
    x: px,
    y: py,
    object: null,
  } as PickingInfo<unknown>;
}

/**
 * Minimal mapbox-gl style that renders a single Web-Mercator (EPSG:3857) raster
 * tile set (served under /basemap/) as the whole base map. Used when a custom
 * 3857 raster folder is selected. EPSG:4326 sets can't be shown this way — they
 * need the plate-carrée renderer (next phase).
 */
function buildRasterMercatorStyle(
  baseUrl: string,
  cfg: TilesConfig,
  cacheKey = "",
): StyleSpecification {
  // ?v= makes immutable tile caching safe across folder switches (same /basemap/
  // path, different folder content) — the Android server uses a fixed port.
  const v = cacheKey ? `?v=${encodeURIComponent(cacheKey)}` : "";
  return {
    version: 8,
    sources: {
      "custom-basemap": {
        type: "raster",
        tiles: [`${baseUrl}/basemap/{z}/{x}/{y}.${cfg.format}${v}`],
        tileSize: cfg.tileSize,
        minzoom: cfg.minZoom,
        maxzoom: cfg.maxZoom,
      },
    },
    layers: [
      {
        id: "custom-basemap",
        type: "raster",
        source: "custom-basemap",
      },
    ],
  } as StyleSpecification;
}

/**
 * Load a custom VECTOR (.pbf) base map: fetch the folder's own style.json from the
 * /basemap/ route and rewrite every vector-tile + glyph URL to point back through
 * /basemap/. Returns false if the folder has no usable style.json. This is what
 * lets a user pick a .pbf folder (same shape as the default) and have it render.
 */
async function applyVectorBasemap(
  map: {
    setStyle: (
      style: StyleSpecification,
      options?: { diff?: boolean },
    ) => void;
  },
  base: string,
  cacheKey: string,
): Promise<boolean> {
  try {
    const res = await fetch(`${base}/style.json`, { cache: "no-store" });
    if (!res.ok) return false;
    const style = (await res.json()) as {
      sources?: Record<
        string,
        {
          type?: string;
          tiles?: string[];
          minzoom?: number;
          maxzoom?: number;
        }
      >;
      glyphs?: string;
      layers?: Array<{ layout?: Record<string, unknown> }>;
    };
    const v = cacheKey ? `?v=${encodeURIComponent(cacheKey)}` : "";
    const toBase = (u: string) => {
      let p = u;
      try {
        p = new URL(u).pathname;
      } catch {
        /* relative template */
      }
      if (!p.startsWith("/")) p = "/" + p;
      return `${base}${p}${v}`;
    };
    if (style.sources) {
      for (const key of Object.keys(style.sources)) {
        const s = style.sources[key];
        if (s?.type === "vector" && Array.isArray(s.tiles)) {
          s.tiles = s.tiles.map(toBase);
          // PRESERVE the tileset's own maxzoom (the tile server declares the real
          // native max, e.g. 14). mapbox OVERZOOMS beyond it — scaling the last real
          // tiles and requesting no more. The old code overwrote it with the camera
          // max, so mapbox fetched the missing higher zooms → 404 → blank. Only fall
          // back to the constant if the source omits maxzoom. (maxNativeZoom is a
          // Leaflet prop mapbox ignores, so it's dropped.)
          s.minzoom = MAP_MIN_ZOOM;
          s.maxzoom = s.maxzoom ?? TILE_SOURCE_MAX_NATIVE_ZOOM;
        }
      }
    }
    if (typeof style.glyphs === "string" && style.glyphs.startsWith("/")) {
      style.glyphs = `${base}${style.glyphs}`;
    } else if (style.layers?.some((l) => l.layout?.["text-field"])) {
      style.glyphs = `${base}/fonts/{fontstack}/{range}.pbf`;
    }
    // `{ diff: false }` — see the note on the default-style apply: the diff path
    // drops our tiled-raster sources/layers and never fires "style.load", so the
    // uploaded rasters would vanish on switching to a vector basemap too.
    map.setStyle(style as unknown as StyleSpecification, { diff: false });
    return true;
  } catch {
    return false;
  }
}

// Settings Button Component
function SettingsButton() {
  const [isOpen, setIsOpen] = useState(false);
  const isElectronBuild = !!(window as any).electronAPI;

  const defaultPaths = (() => {
    if (isElectronBuild) {
      return {
        tiles: "Loading...",
        screenshots: "Loading...",
        downloads: "Loading...",
      };
    }

    return {
      tiles: ANDROID_TILES_PATH,
      screenshots: ANDROID_SCREENSHOTS_PATH,
      downloads: `Internal Storage/Documents`,
    };
  })();

  const [paths, setPaths] = useState(defaultPaths);

  // Single custom base map folder (or the built-in default when none is set).
  const selectFolder = useBasemapStore((s) => s.selectFolder);
  const activeSource = useActiveBasemapSource();
  const [pickingFolder, setPickingFolder] = useState(false);

  // Resolve actual Windows paths from Electron main process
  useEffect(() => {
    if (!isElectronBuild) return;
    const api = (window as any).electronAPI;
    (async () => {
      try {
        const [docsPath, picsPath] = await Promise.all([
          api.getPath("documents"),
          api.getPath("pictures"),
          api.getPath("userData"),
        ]);
        const docs = docsPath.replace(/\\/g, "/");
        const pics = picsPath.replace(/\\/g, "/");
        setPaths({
          tiles: `${docs}/${TILES_FOLDER_NAME}`,
          screenshots: `${pics}/HSC-Screenshots`,
          downloads: `${docs}/HSC-SESSIONS`,
        });
      } catch (err) {
        console.error("[SettingsButton] Failed to resolve paths:", err);
      }
    })();
  }, [isElectronBuild]);

  // Pick a folder and make it THE custom base map (replacing any previous one).
  const handlePickFolder = async () => {
    if (pickingFolder) return;
    setPickingFolder(true);
    try {
      let picked: string | null = null;
      const api = (window as Window & { electronAPI?: ElectronAPI })
        .electronAPI;
      if (api?.openFolder) {
        picked = await api.openFolder();
      } else {
        const res = await OfflineTileServer.selectTileFolder();
        picked = res?.uri ?? null;
      }
      if (picked) {
        selectFolder(basemapLabelFromPath(picked), picked);
      }
    } catch (err) {
      console.error("[SettingsButton] Folder pick failed:", err);
    } finally {
      setPickingFolder(false);
    }
  };

  const displayTilesPath = activeSource ? activeSource.path : paths.tiles;

  return (
    <div className="absolute top-2 right-2 z-50 pointer-events-none">
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            className="h-10 w-10 rounded-sm bg-white/98 shadow-2xl border border-black/10 backdrop-blur-sm hover:bg-white pointer-events-auto"
            title="Storage Paths"
          >
            <Settings className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-80 p-4 bg-white/98 shadow-2xl border border-black/10 backdrop-blur-sm"
          align="end"
          side="bottom"
          sideOffset={8}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="space-y-4">
            <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
              <Settings className="h-4 w-4 text-slate-700" />
              <h3 className="text-sm font-semibold text-slate-800">
                Storage Paths
              </h3>
            </div>

            <div className="space-y-3">
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-blue-500"></div>
                    <span className="text-xs font-semibold text-slate-700 uppercase">
                      Map Tiles
                    </span>
                  </div>
                  <button
                    type="button"
                    className="inline-flex h-6 w-6 items-center justify-center rounded text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:opacity-60"
                    title="Change base map folder"
                    onClick={handlePickFolder}
                    disabled={pickingFolder}
                  >
                    {pickingFolder ? (
                      <Loader2Icon className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Pencil className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
                <p className="text-xs text-slate-600 pl-4 font-mono break-all">
                  {displayTilesPath}
                </p>
              </div>

              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-green-500"></div>
                  <span className="text-xs font-semibold text-slate-700 uppercase">
                    Screenshots
                  </span>
                </div>
                <p className="text-xs text-slate-600 pl-4 font-mono break-all">
                  {paths.screenshots}
                </p>
              </div>

              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-purple-500"></div>
                  <span className="text-xs font-semibold text-slate-700 uppercase">
                    Downloaded Files
                  </span>
                </div>
                <p className="text-xs text-slate-600 pl-4 font-mono break-all">
                  {paths.downloads}
                </p>
              </div>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function DeckGLOverlay({
  layers,
  overlayRef,
  demRasterPickSuppressRef,
}: {
  layers: any[];
  overlayRef: MutableRefObject<MapboxOverlay | null>;
  demRasterPickSuppressRef: MutableRefObject<boolean>;
}) {
  const layersRef = useRef(layers);
  layersRef.current = layers;

  const overlay = useControl<MapboxOverlay>(
    () =>
      new MapboxOverlay({
        layerFilter: (ctx: { layer: { id: string }; isPicking: boolean }) => {
          if (!ctx.isPicking) return true;
          if (!demRasterPickSuppressRef.current) return true;
          const lid = ctx.layer.id;
          if (!lid.endsWith("-bitmap")) return true;
          const baseId = lid
            .replace(/-icon-layer$/, "")
            .replace(/-signal-overlay$/, "")
            .replace(/-bitmap$/, "")
            .replace(/-mesh$/, "");
          const storeLayer = (layersRef.current as LayerProps[]).find(
            (l) => l.id === baseId,
          );
          if (storeLayer?.type === "dem") return false;
          return true;
        },
      }),
  );
  overlayRef.current = overlay;
  useEffect(() => {
    overlay.setProps({ layers });
  }, [overlay, layers]);
  useEffect(() => {
    return () => {
      overlayRef.current = null;
    };
  }, [overlayRef]);

  return null;
}

const MapComponent = ({
  onToggleLayersBox,
  onCloseLayersBox,
  isLayersBoxOpen,
}: {
  onToggleLayersBox?: () => void;
  onCloseLayersBox?: () => void;
  isLayersBoxOpen?: boolean;
}) => {
  const computeSegmentDistancesKm = useCallback((path: [number, number][]) => {
    if (!Array.isArray(path) || path.length < 2) return [] as number[];
    return path.slice(0, -1).map((point, idx) => {
      const next = path[idx + 1];
      return calculateDistanceMeters(point, next) / 1000;
    });
  }, []);

  const arePointsClose = useCallback(
    (a: [number, number], b: [number, number], thresholdMeters = 25) => {
      return calculateDistanceMeters(a, b) <= thresholdMeters;
    },
    [],
  );

  const mapRef = useRef<any>(null);
  const deckOverlayRef = useRef<MapboxOverlay | null>(null);
  /** When true, Deck picking skips DEM `-bitmap` proxies so map click pick is O(vectors) not O(rasters). */
  const demRasterPickSuppressRef = useRef(false);
  const zoomUpdateTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const zoomDebounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    (window as any).mapRef = mapRef;

    // Cleanup timeouts on unmount
    return () => {
      if (zoomUpdateTimeoutRef.current) {
        clearTimeout(zoomUpdateTimeoutRef.current);
      }
      if (zoomDebounceTimeoutRef.current) {
        clearTimeout(zoomDebounceTimeoutRef.current);
      }
    };
  }, []);

  // Detect Android tablet (or allow on any device with touch support for testing)
  useEffect(() => {
    const userAgent = navigator.userAgent.toLowerCase();
    const isAndroid = /android/.test(userAgent);
    const isMobile = /mobile/.test(userAgent);
    const screenWidth = window.innerWidth;

    // Consider it a tablet if Android and not mobile, or screen width > 600px
    // For now, allow on any device with touch support for testing
    const isTabletDevice =
      (isAndroid && !isMobile) ||
      (isAndroid && screenWidth > 600) ||
      "ontouchstart" in window;
    setIsAndroidTablet(isTabletDevice);
  }, []);

  // Reset view and restart tile server when app resumes from background
  useEffect(() => {
    let appStateListener: any;
    let visibilityListener: any;

    const setupAppLifecycle = async () => {
      try {
        // Try to use Capacitor App plugin if available
        const { App } = await import("@capacitor/app");

        // Listen for app state changes (foreground/background)
        appStateListener = await App.addListener(
          "appStateChange",
          async ({ isActive }) => {
            if (isActive) {
              const { initializeTileServer } =
                await import("./tile-folder-dialog");
              // Wait for permissions when app comes to foreground (user might have granted them)
              const url = await initializeTileServer(true);

              if (url) {
                // Force retry by clearing and resetting URL to trigger style reload
                setTileServerUrl(null);
                setTimeout(() => {
                  setTileServerUrl(url);
                }, 100);
              }

              // Reset view to India to force re-render
              if (mapRef.current) {
                setTimeout(() => {
                  handleResetHome();
                }, 100);
              }
            }
          },
        );
      } catch (error) {
        // Capacitor App plugin not available, use browser visibility API as fallback
        const handleVisibilityChange = async () => {
          if (!document.hidden) {
            // App came to foreground - restart tile server fresh

            const { initializeTileServer } =
              await import("./tile-folder-dialog");
            // Wait for permissions when app comes to foreground (user might have granted them)
            const url = await initializeTileServer(true);

            if (url) {
              // Force retry by clearing and resetting URL to trigger style reload
              setTileServerUrl(null);
              setTimeout(() => {
                setTileServerUrl(url);
              }, 100);
            }

            // Reset view to India to force re-render
            if (mapRef.current) {
              setTimeout(() => {
                handleResetHome();
              }, 100);
            }
          }
        };

        visibilityListener = handleVisibilityChange;
        document.addEventListener("visibilitychange", handleVisibilityChange);
      }
    };

    setupAppLifecycle();

    return () => {
      if (appStateListener) {
        appStateListener.remove();
      }
      if (visibilityListener) {
        document.removeEventListener("visibilitychange", visibilityListener);
      }
    };
  }, []);

  // UDP config dialog removed - port is now fixed at 40074, data arrives automatically from intranet

  const { networkLayersVisible } = useNetworkLayersVisible();
  const topologyNodes = useUdpDataStore((s) => s.udpData.topology.nodes);
  /**
   * True while the Route Finder is waiting for an A or B point.
   *
   * A ref, not state, because the raster pick handler is attached to the mapbox map
   * ONCE (empty deps) and must read the live value, and because
   * `commitDeckPickToHover` is called from deck's hover callbacks where a stale
   * closure would let a tooltip through.
   */
  const routePickActiveRef = useRef(false);

  /**
   * Live `getZoomVisibility`, for handlers that cannot depend on it.
   *
   * The raster pick handler is attached to the mapbox map ONCE (empty deps), so it
   * would otherwise capture the predicate from first render and pick rasters using a
   * stale zoom. Assigned during render below, which always runs before the handler
   * can fire.
   */
  const getZoomVisibilityRef = useRef<(layer: LayerProps) => boolean>(
    () => true,
  );

  // Subscribed so an open tooltip can be closed the moment its subject stops
  // arriving from the UDP feed (see the staleness effect below).
  const topologyConnections = useUdpDataStore(
    (s) => s.udpData.topology.connections,
  );
  const udpNetworkMembers = useUdpDataStore((s) => s.udpData.networkMembers);
  const udpTargets = useUdpDataStore((s) => s.udpData.targets);
  const { dragStart, setDragStart } = useDragStart();
  const { mousePosition, setMousePosition } = useMousePosition();
  const { layers, addLayer, setLayers, bringLayerToTop } = useLayers();
  // const { setNodeIconMappings } = useNodeIconMappings();
  const { focusLayerRequest, setFocusLayerRequest } = useFocusLayerRequest();
  const { drawingMode } = useDrawingMode();
  const { isDrawing, setIsDrawing } = useIsDrawing();
  const { currentPath, setCurrentPath } = useCurrentPath();
  const { hoverInfo, setHoverInfo } = useHoverInfo();
  const { pendingPolygonPoints, setPendingPolygonPoints } = usePendingPolygon();
  const useIgrs = useIgrsPreference();
  const setUseIgrs = useSetIgrsPreference();
  const {
    userLocation,
    showUserLocation,
    setShowUserLocation,
    setUserLocation,
  } = useUserLocation();
  const previousDrawingModeRef = useRef(drawingMode);

  // const { nodeCoordinatesData, setNodeCoordinatesData } =
  //   useProgressiveNodes(networkLayersVisible);
  const [isMapEnabled] = useState(true);
  const [pitch, setPitch] = useState(0);
  const [rubberBandMode, setRubberBandMode] = useState(false);
  const [isRubberBandDrawing, setIsRubberBandDrawing] = useState(false);
  const [isRubberBandZooming, setIsRubberBandZooming] = useState(false);
  const [rubberBandStart, setRubberBandStart] = useState<
    [number, number] | null
  >(null);
  const [rubberBandEnd, setRubberBandEnd] = useState<[number, number] | null>(
    null,
  );
  const [isAndroidTablet, setIsAndroidTablet] = useState(false);
  const [rubberBandToastId, setRubberBandToastId] = useState<string | null>(
    null,
  );

  const [selectedNodeForIcon, setSelectedNodeForIcon] = useState<string | null>(
    null,
  );
  const [mapZoom, setMapZoom] = useState(INITIAL_MAP_ZOOM);
  const [mapBearing, setMapBearing] = useState(0);
  // UDP config dialog state removed - port is now fixed at 40074
  const [showConnectionError, setShowConnectionError] = useState(false);
  const [isCameraPopoverOpen, setIsCameraPopoverOpen] = useState(false);
  const [isMeasurementBoxOpen, setIsMeasurementBoxOpen] = useState(false);
  const [isNetworkBoxOpen, setIsNetworkBoxOpen] = useState(false);
  const [isRoutePanelOpen, setIsRoutePanelOpen] = useState(false);
  const [routeState, setRouteState] = useState<RouteToolState>(
    initialRouteToolState,
  );
  const dijkstraWorkerRef = useRef<Worker | null>(null);
  // Mirror "waiting for a route endpoint" into the ref the pick handlers read, and
  // dismiss any tooltip already on screen when placement begins — otherwise a panel
  // opened a moment earlier keeps covering the spot the user is aiming at.
  useEffect(() => {
    const active = isRoutePanelOpen && !!routeState.pickMode;
    routePickActiveRef.current = active;
    if (active) setHoverInfo(undefined);
  }, [isRoutePanelOpen, routeState.pickMode, setHoverInfo]);
  const [isProcessingFiles, setIsProcessingFiles] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [tileServerUrl, setTileServerUrl] = useState<string | null>(null);
  // Flips true once the mapbox instance has loaded. The custom-basemap apply effect
  // depends on this so it RE-RUNS when the map becomes ready. On restart the tile
  // server URL and the rehydrated basemap selection can both be set BEFORE the map
  // instance exists, so the effect's first run bails on a null map and — since no
  // other dependency changes afterward — would never fire again, leaving the
  // default basemap loaded instead of the saved one.
  const [mapLoaded, setMapLoaded] = useState(false);
  const [tileDataError, setTileDataError] = useState<string | null>(null);
  // Live "is the map actually rendering tiles?" signal — driven by the fetch
  // interceptor (see the tile-server effect below). It latches true the instant ANY
  // tile returns OK, from mapbox raster/vector sources OR the deck.gl geodetic view.
  // This is the ONE signal that works across every renderer (mapbox-only style
  // checks miss the geodetic deck view entirely); a blank map where every tile 404s
  // never sets it.
  const [mapHasTiles, setMapHasTiles] = useState(false);
  // True once the user dismisses the dialog, so a persistently-blank map doesn't
  // re-pop it. Reset when the active basemap changes (see effect below) so a
  // freshly-picked basemap is judged on its own.
  const [tileErrorDismissed, setTileErrorDismissed] = useState(false);
  // Sets the dialog's MESSAGE text (specific failure paths call this). The dialog no
  // longer TRIGGERS on it — it triggers on a blank map (effect below) — so this is
  // purely informational; a null message falls back to a default in the dialog.
  const showTileDataError = useCallback((msg: string) => {
    setTileDataError(msg);
  }, []);
  // The "Map Data Not Found" dialog fires when — after a grace period long enough
  // for even a slow relaunch to render — the map STILL has no tiles (`!mapHasTiles`),
  // the tile server is up, and the user hasn't dismissed it. Renderer-agnostic: a
  // default-style 404, a custom basemap with no usable tiles, or a geodetic folder
  // whose tiles all 404 ALL mean "nothing rendered" and all land here. If any tile
  // loads within the grace, `mapHasTiles` latches true and the dialog never shows.
  // One honest condition that fixes BOTH the false-positive-over-a-working-map AND
  // the missing-dialog-over-a-blank-map bugs.
  const [tileDataErrorConfirmed, setTileDataErrorConfirmed] = useState(false);
  useEffect(() => {
    if (mapLoaded && tileServerUrl && !mapHasTiles && !tileErrorDismissed) {
      const t = setTimeout(() => setTileDataErrorConfirmed(true), 4000);
      return () => clearTimeout(t);
    }
    setTileDataErrorConfirmed(false);
  }, [mapLoaded, tileServerUrl, mapHasTiles, tileErrorDismissed]);
  // Custom base map switching (Storage Paths → Map Tiles). activeId === null is
  // the built-in default (Documents/tiles vector), so this is inert until a user
  // picks another folder — the current basemap path is left completely untouched.
  const basemapActiveId = useBasemapStore((s) => s.activeId);
  const basemapSources = useBasemapStore((s) => s.sources);
  const selectBasemapFolder = useBasemapStore((s) => s.selectFolder);
  const customBasemapActiveRef = useRef(false);
  const [pickingBasemapFolder, setPickingBasemapFolder] = useState(false);
  // Re-evaluate the "map is blank" check whenever the active basemap changes: the
  // newly-selected basemap must prove it can load a tile, and any prior dismissal is
  // cleared so a broken new basemap warns on its own. (mapHasTiles latches true on
  // the first loaded tile from the new basemap; if none load, the dialog returns.)
  useEffect(() => {
    setMapHasTiles(false);
    setTileErrorDismissed(false);
  }, [basemapActiveId]);
  // "Change folder" action for the not-found dialog: pick a new basemap folder and
  // make it active. Clears the not-found state so the new folder is judged fresh —
  // if it has tiles the dialog closes; if it's also empty the dialog returns showing
  // the new path. Same picker the Storage Paths panel uses.
  const handleChangeBasemapFolder = async () => {
    if (pickingBasemapFolder) return;
    setPickingBasemapFolder(true);
    try {
      let picked: string | null = null;
      const api = (window as Window & { electronAPI?: ElectronAPI })
        .electronAPI;
      if (api?.openFolder) {
        picked = await api.openFolder();
      } else {
        const res = await OfflineTileServer.selectTileFolder();
        picked = res?.uri ?? null;
      }
      if (picked) {
        setTileDataError(null);
        setTileErrorDismissed(false);
        setMapHasTiles(false);
        selectBasemapFolder(basemapLabelFromPath(picked), picked);
      }
    } catch (err) {
      console.error("[Map] Basemap folder pick failed:", err);
    } finally {
      setPickingBasemapFolder(false);
    }
  };
  // Bumped to force the default vector style to reload (e.g. reverting to Default).
  const [vectorStyleNonce, setVectorStyleNonce] = useState(0);
  // Geodetic (EPSG:4326) plate-carrée mode: non-null while a 4326 base map is
  // active. Rendered as a deck.gl OrthographicView overlay above the (covered)
  // mapbox map, so Mercator mode is untouched. Ref mirrors state for effect logic.
  const [geodeticBasemap, setGeodeticBasemap] = useState<{
    config: TilesConfig;
    baseUrl: string;
  } | null>(null);
  const geodeticBasemapRef = useRef<typeof geodeticBasemap>(null);
  const geodeticInitRef = useRef<{ center: [number, number]; zoom: number }>({
    center: [DEFAULT_CENTER[0], DEFAULT_CENTER[1]],
    zoom: mapboxZoomToOrtho(DEFAULT_ZOOM),
  });
  const geodeticViewRef = useRef<{ center: [number, number]; zoom: number }>(
    geodeticInitRef.current,
  );
  // A one-shot view command pushed to the geodetic OrthographicView. In geodetic
  // mode the mapbox camera is covered and inert, so "focus layer" (and any camera
  // move) must be routed here instead of to map.fitBounds/flyTo.
  const geodeticCmdNonceRef = useRef(0);
  const [geodeticCommand, setGeodeticCommand] = useState<{
    center: [number, number];
    zoom: number;
    nonce: number;
  } | null>(null);
  const applyGeodeticBasemap = useCallback(
    (v: { config: TilesConfig; baseUrl: string } | null) => {
      geodeticBasemapRef.current = v;
      setGeodeticBasemap(v);
    },
    [],
  );
  // Tiled rasters (mapbox raster sources in Mercator mode) re-expressed for the
  // geodetic view, which renders their Web-Mercator tiles at true lng/lat bounds.
  const geodeticRasterLayers = useMemo(
    () =>
      layers
        .filter((l) => l.tilesUrl && l.visible !== false)
        .map((l) => ({
          id: l.id,
          tilesUrl: l.tilesUrl as string,
          tileMinZoom: l.tileMinZoom,
          tileMaxZoom: l.tileMaxZoom,
          // The settings panel's Min/Max Zoom. Without these the geodetic view had
          // no way to honour the slider, so Min Zoom silently did nothing to a
          // raster on any EPSG:4326 basemap (it worked on mercator basemaps, where
          // the mapbox layer gets minzoom/maxzoom from resolveLayerZoomRange).
          userMinZoom: l.minzoom,
          userMaxZoom: l.maxzoom,
          tileBoundsWgs84: l.tileBoundsWgs84,
          opacity:
            Array.isArray(l.color) && l.color.length === 4
              ? Math.max(0, Math.min(1, (l.color[3] as number) / 255))
              : 1,
        })),
    [layers],
  );
  const [expectedTilePath, setExpectedTilePath] = useState<string>(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = (window as any).electronAPI;
    return api
      ? `Documents / ${TILES_FOLDER_NAME}`
      : `Internal Storage / Documents / ${TILES_FOLDER_NAME}`;
  });
  // When a CUSTOM basemap is the active one that failed to load, the dialog should
  // point at ITS saved folder (the path the user actually selected), not the default
  // Documents/tiles — otherwise the "expected location" is misleading. Falls back to
  // the default location when no custom basemap is active.
  const activeBasemapForError =
    basemapActiveId != null
      ? (basemapSources.find((s) => s.id === basemapActiveId) ?? null)
      : null;
  const missingTilesPath = activeBasemapForError?.path ?? expectedTilePath;
  const lastLayerCreationTimeRef = useRef<number>(0);

  // Reset route tool state when the layer used for routing is deleted (avoids stale path/graph).
  useEffect(() => {
    const id = routeState.selectedLayerId;
    if (!id) return;
    if (layers.some((l) => l.id === id)) return;
    setRouteState(initialRouteToolState);
    if (dijkstraWorkerRef.current) {
      dijkstraWorkerRef.current.terminate();
      dijkstraWorkerRef.current = null;
    }
  }, [layers, routeState.selectedLayerId]);

  // Persist every calculated shortest route as its OWN geojson layer + staged manifest file
  // (main Layers panel). Each distinct A→B route accumulates: earlier routes stay on the map and
  // in the unstaged changes, so saving/autosaving the session persists all of them.
  const lastPersistedRouteKeyRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    const path = routeState.pathResult?.path;
    if (!path || path.length < 2) return;
    const from = routeState.snappedA ?? routeState.pointA;
    const to = routeState.snappedB ?? routeState.pointB;
    if (!from || !to) return;

    const distMeters = routeState.pathResult?.dist ?? 0;
    // Key off the computed path geometry (stable across snapped-endpoint display updates) so a
    // single route isn't persisted twice, while genuinely distinct routes each get their own layer.
    const start = path[0];
    const end = path[path.length - 1];
    const routeKey = `${start[0]},${start[1]}|${end[0]},${end[1]}|${path.length}|${distMeters}`;
    if (lastPersistedRouteKeyRef.current === routeKey) return;
    lastPersistedRouteKeyRef.current = routeKey;

    // Sequential name ("Shortest Route 3"), NOT the coordinate-built one. The
    // from/to pair is rendered as the row's subtitle by the panels, so baking it
    // into the name put the same coordinates on screen twice and left no short
    // label to identify the route by.
    const name = nextShortestRouteName(layers);

    void (async () => {
      try {
        const id = generateLayerId();
        const { layer } = await persistShortestRouteToSession({
          layerId: id,
          layerName: name,
          path,
          distMeters,
        });
        addLayer(layer);
        bringLayerToTop(id);
        lastLayerCreationTimeRef.current = Date.now();
      } catch (err) {
        console.error("[ShortestRoute] Failed to persist route layer:", err);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- persist only when route result/endpoints change
  }, [
    routeState.pathResult,
    routeState.snappedA,
    routeState.snappedB,
    routeState.pointA,
    routeState.pointB,
  ]);

  const closeRoutePanel = useCallback(() => {
    setIsRoutePanelOpen(false);
    if (dijkstraWorkerRef.current) {
      dijkstraWorkerRef.current.terminate();
      dijkstraWorkerRef.current = null;
    }
    setRouteState(initialRouteToolState);
    lastPersistedRouteKeyRef.current = null;
  }, []);

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = (window as any).electronAPI;
    if (!api) return;
    api
      .getPath("documents")
      .then((docsPath: string) => {
        const docs = docsPath.replace(/\\/g, "/");
        setExpectedTilePath(`${docs}/${TILES_FOLDER_NAME}`);
      })
      .catch(() => {});
  }, []);

  // Initialize tile server on mount and set up fetch interceptor for tile logging
  useEffect(() => {
    const initServer = async () => {
      // Wait for permissions on initial load (user might need to grant them)
      const url = await initializeTileServer(true);
      if (url) {
        setTileServerUrl(url);

        // Intercept fetch requests to log tile requests AND to drive `mapHasTiles`.
        // This is the ONE place every tile fetch flows through — mapbox raster/
        // vector sources AND the deck.gl geodetic BitmapLayer. So a tile that comes
        // back OK here is the ground truth that "the map is showing real data",
        // regardless of which renderer requested it (the mapbox-only getStyle/data
        // checks miss the deck geodetic view entirely). A blank map where every tile
        // 404s never sets it → the "Map Data Not Found" dialog correctly appears.
        const originalFetch = window.fetch;
        window.fetch = async function (...args) {
          // mapbox-gl AND deck/loaders.gl pass a Request OBJECT here, not a string
          // (so the old `args[0].toString()` gave "[object Request]" and never
          // matched — that's why tiles fell through and this signal was dead). Read
          // `.url` off the Request; handle string / URL forms too.
          const first = args[0] as any;
          const url =
            typeof first === "string"
              ? first
              : (first?.url ?? String(first ?? ""));
          // Any XYZ tile: /{z}/{x}/{y}.{pbf|png|jpg|jpeg|webp}. Glyphs
          // (/fonts/.../0-255.pbf) and sprites (/sprite.png) don't match this shape.
          const tileMatch = url.match(
            /\/(\d+)\/(\d+)\/(\d+)\.(pbf|png|jpe?g|webp)/i,
          );

          if (tileMatch) {
            const [, z, x, y] = tileMatch;

            try {
              const response = await originalFetch.apply(this, args);
              if (response.ok) {
                // A real tile loaded → the map is rendering data. Latch it so the
                // dialog can't show over a working map (any renderer).
                setMapHasTiles(true);
              } else {
                console.error(
                  `CAPACITOR_HAHA [Tile Request] FAILED: z=${z}, x=${x}, y=${y} - Status: ${response.status} ${response.statusText}`,
                );
              }
              return response;
            } catch (error) {
              console.error(
                `CAPACITOR_HAHA [Tile Request] ERROR: z=${z}, x=${x}, y=${y} -`,
                error,
              );
              throw error;
            }
          }

          return originalFetch.apply(this, args);
        };
      }
    };

    initServer();

    // Cleanup: restore original fetch on unmount
    return () => {
      // Note: We can't easily restore fetch without storing the original,
      // but this is fine as it only runs once on mount
    };
  }, []);

  // Fire-and-forget: keep `toastId` in loading state until Mapbox has
  // actually rendered the layer's visible tiles. Without this, the upload
  // flow ack'd "ready" the moment `runTilingUpload` returned — long before
  // any pixel hit the canvas.
  const waitAndAckTiledLayer = useCallback(
    (layerId: string, displayName: string, toastId: any) => {
      const map = mapRef.current?.getMap?.();
      if (!map) {
        toast.dismiss(toastId);
        return;
      }
      void waitForRasterTilesLoaded(map, layerId).then((ok) => {
        if (ok) {
          toast.update(toastId, `${displayName} loaded`, "success");
        } else {
          // Hit the timeout — tiles likely still rendering. Don't claim
          // success; just drop the toast so the UI doesn't show a stale
          // "Tiling..." forever. The user sees ongoing visual progress
          // as tiles continue to fill in.
          toast.dismiss(toastId);
        }
      });
    },
    [],
  );

  // ── Tiled raster Mapbox source/layer manager ──────────────────────────
  // For every layer with `tilesUrl`, add (or update) a Mapbox raster
  // source pointing at the local tile server. Track which sources we own
  // so we tear them down when the layer is removed.
  const ownedTiledLayerIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!mapRef.current) return;
    const map = mapRef.current.getMap?.();
    if (!map) return;

    const apply = () => {
      const liveIds = new Set<string>();
      for (const l of layers) {
        if (!l.tilesUrl) continue;
        liveIds.add(l.id);
        try {
          addOrUpdateTiledRaster(map, l);
        } catch (err) {
          console.warn(`[TiledRaster] add ${l.id} failed:`, err);
        }
      }
      // Remove sources whose layers are gone (or no longer tiled).
      for (const oldId of ownedTiledLayerIdsRef.current) {
        if (!liveIds.has(oldId)) {
          try {
            removeTiledRaster(map, oldId);
          } catch {
            /* noop */
          }
        }
      }
      // Then sweep the STYLE itself for any `raster-*` layer whose store layer is
      // gone. The ref above only knows what this effect last believed it owned, and
      // it can drift: a `setStyle` destroys these layers without going through
      // removeTiledRaster, an early run bails before the map exists, and a stale
      // `once("load")` closure could re-add an already-deleted id. When it drifted
      // this way the raster stayed painted after being deleted from the layers
      // panel. Reading the style makes teardown self-correcting.
      try {
        pruneOrphanTiledRasters(map, liveIds);
      } catch {
        /* style not queryable — the ref-based pass above still ran */
      }
      ownedTiledLayerIdsRef.current = liveIds;
    };

    if (map.isStyleLoaded?.()) {
      apply();
    } else {
      // NOTE: this listener must be removed on cleanup too. It captures `layers`
      // from THIS render, so if it fired after a delete it would re-add the
      // removed raster and then overwrite ownedTiledLayerIdsRef with the stale
      // set — a ghost the next pass would no longer know to remove.
      map.once?.("load", apply);
    }
    // Re-attach tiled rasters after ANY full style replacement (e.g. switching
    // the base map via setStyle) — a one-shot listener would drop them on the
    // second style load, wiping user raster layers.
    //
    // This only works because the basemap `setStyle` calls now pass
    // `{ diff: false }`. On mapbox's default diff path the raster layers are
    // removed but "style.load" is never emitted, so this listener never ran.
    map.on?.("style.load", apply);
    return () => {
      try {
        map.off?.("style.load", apply);
        // Drop the pending one-shot too, so a `load` that arrives after this
        // render's `layers` snapshot went stale cannot resurrect a deleted raster.
        map.off?.("load", apply);
      } catch {
        /* noop */
      }
    };
  }, [layers]);

  // ── Viewport culling for tiled rasters ───────────────────────────────
  // Hide tiled raster layers whose bounds don't intersect the current
  // viewport. Without this, Mapbox runs style + tile-state evaluation
  // for ALL N raster layers every frame even though only the few in
  // view actually paint. With ~150 layers, that overhead is significant
  // on a tablet WebView.
  //
  // O(N) intersection per cull call, sub-millisecond for N=200.

  // Mirror layers into a ref so the cull callback (attached once) reads
  // the current set without re-attaching listeners on every store mutation.
  const layersForCullingRef = useRef(layers);
  useEffect(() => {
    layersForCullingRef.current = layers;
  }, [layers]);

  // Pull cull() out so both the listener-attach effect (runs once) and
  // the layers-changed effect (re-cull when layer set mutates) can call it.
  const cullTiledRastersRef = useRef<() => void>(() => {});

  // Track which tiled rasters were in view on the previous cull pass so
  // we can detect "newly entered viewport" and pre-warm their sampleAt
  // cache (gdal.Open + PROJ setup happens on the dedicated samplePool
  // BEFORE the user taps). Without this, the first tap on any newly-
  // visible layer pays a 250-500 ms cold-storage cost.
  const lastVisibleTiledRasterIdsRef = useRef<Set<string>>(new Set());

  // Effect A: attach moveend/zoomend listeners ONCE. Detach on unmount.
  useEffect(() => {
    if (!mapRef.current) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const map = (mapRef.current as any).getMap?.();
    if (!map) return;

    const cull = () => {
      try {
        const b = map.getBounds?.();
        if (!b) return;
        const viewport: [number, number, number, number] = [
          b.getWest(),
          b.getSouth(),
          b.getEast(),
          b.getNorth(),
        ];
        const layersNow = layersForCullingRef.current;
        applyTiledRasterViewportCulling(map, layersNow, viewport);

        // Pre-warm: for any tiled raster that's newly in the viewport,
        // fire a throwaway sampleAt at its centroid. Capacitor IPC is
        // async; the samplePool processes it in the background so the
        // dataset + SR/CT are cached by the time the user taps.
        const [vw, vs, ve, vn] = viewport;
        const nowVisible = new Set<string>();
        const newlyVisible: Array<{ id: string; lon: number; lat: number }> =
          [];
        for (const l of layersNow) {
          if (!l.tilesUrl || !l.tileBoundsWgs84) continue;
          if (l.visible === false) continue;
          const [lw, ls, le, ln] = l.tileBoundsWgs84;
          const inView = !(le < vw || lw > ve || ln < vs || ls > vn);
          if (!inView) continue;
          nowVisible.add(l.id);
          if (lastVisibleTiledRasterIdsRef.current.has(l.id)) continue;
          // Centroid of layer bounds — any in-bounds point works for
          // warming the cache; the value is discarded.
          newlyVisible.push({
            id: l.id,
            lon: (lw + le) / 2,
            lat: (ls + ln) / 2,
          });
        }
        lastVisibleTiledRasterIdsRef.current = nowVisible;

        if (newlyVisible.length > 0) {
          // Fire-and-forget. Capacitor.Plugins may not be available in
          // dev / Electron — guard cleanly.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const cap: any = (window as any).Capacitor;
          const rt = cap?.Plugins?.RasterTiling;
          if (rt?.sampleAt) {
            for (const { id, lon, lat } of newlyVisible) {
              rt.sampleAt({ layerId: id, lon, lat }).catch(() => {});
            }
          }
        }
      } catch {
        /* style may not be loaded yet — safe to skip */
      }
    };
    cullTiledRastersRef.current = cull;

    // Run once now (or queue for first style load).
    if (map.isStyleLoaded?.()) {
      cull();
    } else {
      map.once?.("load", cull);
      map.once?.("style.load", cull);
    }

    map.on?.("moveend", cull);
    map.on?.("zoomend", cull);

    return () => {
      try {
        map.off?.("moveend", cull);
        map.off?.("zoomend", cull);
      } catch {
        /* noop */
      }
    };
    // Listeners attach once. Layer-set changes are picked up via
    // layersForCullingRef (Effect B below triggers an immediate re-cull).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Effect B: re-cull immediately when the layer set changes (new layer
  // added, visibility toggled, etc.) so the user sees the right set
  // without waiting for the next pan/zoom.
  useEffect(() => {
    cullTiledRastersRef.current?.();
  }, [layers]);

  // Tooltip-on-leave fix for tiled rasters. deck.gl's onHover does not fire
  // reliably when the cursor leaves a SolidPolygonLayer picking proxy, so the
  // tooltip would stick at the last hovered position with stale data. We
  // listen to Mapbox's mousemove (which fires regardless of deck.gl picking)
  // and clear hoverInfo when the cursor's actual lng/lat is outside the
  // currently hovered raster's bounds. Refs keep this off the React render
  // path so mousemove stays cheap.
  const hoveredRasterBoundsRef = useRef<
    [number, number, number, number] | null
  >(null);
  useEffect(() => {
    if (!hoverInfo) {
      hoveredRasterBoundsRef.current = null;
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const deckLayerId = (hoverInfo.layer as any)?.id as string | undefined;
    if (!deckLayerId) {
      hoveredRasterBoundsRef.current = null;
      return;
    }
    const baseId = deckLayerId
      .replace(/-icon-layer$/, "")
      .replace(/-signal-overlay$/, "")
      .replace(/-bitmap$/, "")
      .replace(/-mesh$/, "");
    const matched = layers.find((l) => l.id === baseId);
    hoveredRasterBoundsRef.current =
      matched?.tilesUrl && matched.tileBoundsWgs84
        ? matched.tileBoundsWgs84
        : null;
  }, [hoverInfo, layers]);

  // Tracks the currently-picked raster so we know when to fire
  // setHoverInfo(undefined) on leave (cursor exits all raster bounds)
  // without spamming React on every move within the same raster.
  const lastPickedRasterIdRef = useRef<string | null>(null);

  // Set true between movestart and moveend. handleRasterPick early-returns
  // while panning so we don't fire 60 setHoverInfo / React re-renders per
  // second during a drag. Tap (click) is unaffected: Mapbox doesn't fire
  // click when the touch turned into a drag, only on a clean tap.
  const isPanningRef = useRef(false);

  const rasterMousemoveAttachedRef = useRef(false);
  useEffect(() => {
    if (rasterMousemoveAttachedRef.current) return;
    if (!mapRef.current) return;
    const map = mapRef.current.getMap?.();
    if (!map) return;

    // Combined enter/leave handler.
    //
    // BEFORE: deck.gl ran a synchronous GPU picking pass over all 153
    // SolidPolygonLayer raster proxies on every mousemove/tap — multi-
    // second main-thread stall on tablet WebView. Native sampleAt was
    // also slow then, masking this.
    //
    // NOW: SolidPolygonLayer rasters have pickable: false (see
    // deckGlLayers below). This handler walks the rect index in JS
    // (sub-millisecond for any N), picks the topmost containing raster,
    // synthesises a hoverInfo shape compatible with what deck.gl picking
    // would have produced, and fires setHoverInfo. The downstream
    // tooltip + tile-sampler effects continue to work unchanged.
    //
    // Vector / point / polygon / line layers stay GPU-picked via
    // handleLayerHover — only raster picking is moved to JS.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleRasterPick = (e: any) => {
      // Skip during active pan/zoom — prevents 60 Hz re-render churn
      // while the user is dragging the map. Re-enabled at moveend below.
      if (isPanningRef.current) return;
      const lng = e?.lngLat?.lng;
      const lat = e?.lngLat?.lat;
      if (typeof lng !== "number" || typeof lat !== "number") return;

      // Walk visible DEM rasters top-down (most recent in array =
      // visually topmost, mirrors deck.gl picking order). Handles BOTH:
      //   • Tiled rasters: bounds at l.tileBoundsWgs84
      //   • Non-tiled BitmapLayer rasters: bounds at l.bounds[[w,s],[e,n]]
      // Same hit-test algorithm (point-in-rect) for both — the only
      // difference is which field holds the rectangle.
      const layersNow = layersForCullingRef.current;
      let hitId: string | null = null;
      for (let i = layersNow.length - 1; i >= 0; i--) {
        const l = layersNow[i];
        if (l.visible === false) continue;
        if (l.type !== "dem") continue;
        // Skip rasters the zoom range has hidden. Without this, a raster that is
        // NOT being drawn is still pickable: the "close the tooltip when the layer
        // is zoom-hidden" effect would dismiss the panel, and then the very next
        // mousemove over the same bounds re-opened it — so on a mouse-driven
        // desktop the tooltip appeared never to close at all.
        if (!getZoomVisibilityRef.current(l)) continue;

        let w: number, s: number, ee: number, n: number;
        if (l.tilesUrl && l.tileBoundsWgs84) {
          // Tiled raster — bounds already in [w, s, e, n] form.
          [w, s, ee, n] = l.tileBoundsWgs84;
        } else if (
          Array.isArray(l.bounds) &&
          l.bounds.length === 2 &&
          Array.isArray(l.bounds[0]) &&
          Array.isArray(l.bounds[1])
        ) {
          // Non-tiled BitmapLayer raster — bounds is [[minLng, minLat], [maxLng, maxLat]].
          w = l.bounds[0][0];
          s = l.bounds[0][1];
          ee = l.bounds[1][0];
          n = l.bounds[1][1];
        } else {
          continue;
        }

        if (lng >= w && lng <= ee && lat >= s && lat <= n) {
          hitId = l.id;
          break;
        }
      }

      if (!hitId) {
        // Cursor / tap outside all raster bounds → clear stale tooltip.
        if (lastPickedRasterIdRef.current) {
          lastPickedRasterIdRef.current = null;
          setHoverInfo(undefined);
        }
        return;
      }

      // Suppress hover/tap briefly after layer creation — matches the
      // 500 ms cooldown handleLayerHover used to enforce on tablets,
      // where rapid layer adds during upload fired spurious hovers.
      const sinceCreation = Date.now() - lastLayerCreationTimeRef.current;
      if (sinceCreation < 500) {
        if (lastPickedRasterIdRef.current) {
          lastPickedRasterIdRef.current = null;
          setHoverInfo(undefined);
        }
        return;
      }

      lastPickedRasterIdRef.current = hitId;

      // Synthesise hoverInfo. Tooltip code reads layer.id (with -bitmap
      // suffix the deck.gl path produced — preserved so the regex strip
      // in tooltip.tsx still finds the base id), coordinate, x, y, and
      // object (null for rasters).
      const screenX = e?.point?.x ?? 0;
      const screenY = e?.point?.y ?? 0;
      setHoverInfo({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        layer: { id: `${hitId}-bitmap` } as any,
        coordinate: [lng, lat],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        object: null as any,
        x: screenX,
        y: screenY,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
    };

    // mousemove handles desktop pointer movement.
    // click handles touch taps on Android — touch devices don't fire
    // mousemove reliably between two distant taps, so without this the
    // tooltip would stick at the previously-tapped raster position.
    map.on("mousemove", handleRasterPick);
    map.on("click", handleRasterPick);

    // Suspend the pick during active pan/zoom to avoid React re-render
    // churn (60 Hz mousemove × setHoverInfo × ~150-layer tree = visible
    // pan jank). Mapbox's click event doesn't fire if the gesture turned
    // into a drag, so taps on rasters still work cleanly.
    const onMoveStart = () => {
      isPanningRef.current = true;
    };
    const onMoveEnd = () => {
      isPanningRef.current = false;
    };
    map.on("movestart", onMoveStart);
    map.on("zoomstart", onMoveStart);
    map.on("moveend", onMoveEnd);
    map.on("zoomend", onMoveEnd);

    rasterMousemoveAttachedRef.current = true;
    // Listeners attach once. Layer set is read live via layersForCullingRef.
    // setHoverInfo + lastLayerCreationTimeRef are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reload style when tileServerUrl changes (after map is loaded)
  useEffect(() => {
    if (!tileServerUrl || !mapRef.current) return;

    const map = mapRef.current.getMap();
    if (!map || !map.loaded()) return;

    // A custom (raster) base map owns the style right now — don't overwrite it
    // with the default vector style. Reverting to Default clears this flag first.
    if (customBasemapActiveRef.current) return;

    // Load style from URL
    const styleUrl = `${tileServerUrl}/style.json`;

    try {
      // Fetch style.json to modify it
      fetch(styleUrl)
        .then(async (response) => {
          // If 404, check permissions and retry once
          if (response.status === 404) {
            console.warn(
              "[Map] style.json not found (404), checking permissions...",
            );
            const { checkStoragePermission, waitForStoragePermission } =
              await import("./tile-folder-dialog");
            const hasPermission = await checkStoragePermission();
            if (!hasPermission) {
              const granted = await waitForStoragePermission(
                STORAGE_PERMISSION_TIMEOUT_MS,
              );
              if (granted) {
                // Retry fetch
                const retryResponse = await fetch(styleUrl);
                if (retryResponse.ok) {
                  return retryResponse.json();
                }
              }
            }
            // If still 404 or no permission, throw error
            throw new Error(
              `style.json not found (404) - Check if file exists in Documents/${TILES_FOLDER_NAME}/ and permissions are granted`,
            );
          }
          if (!response.ok) {
            throw new Error(`Failed to fetch style.json: ${response.status}`);
          }
          return response.json();
        })
        .then((styleJson) => {
          // Force ALL tile URLs to point to tile server
          if (styleJson.sources) {
            Object.keys(styleJson.sources).forEach((sourceKey) => {
              const source = styleJson.sources[sourceKey];
              if (source.type === "vector" && source.tiles) {
                source.tiles = source.tiles.map((tileUrl: string) => {
                  // Extract the tile path (e.g., /3/5/3.pbf from any URL format)
                  let tilePath = tileUrl;

                  // If it's an absolute URL, extract the path
                  try {
                    const url = new URL(tilePath);
                    tilePath = url.pathname;
                  } catch {
                    // Not a valid URL, might be relative or template
                  }

                  // Handle Mapbox tile URL templates like {z}/{x}/{y}.pbf
                  // If it's a template, keep it but ensure it points to our server
                  if (
                    tilePath.includes("{z}") ||
                    tilePath.includes("{x}") ||
                    tilePath.includes("{y}")
                  ) {
                    // Template format - ensure it starts with / and use our server
                    if (!tilePath.startsWith("/")) {
                      tilePath = "/" + tilePath;
                    }
                    return `${tileServerUrl}${tilePath}`;
                  }

                  // Regular tile path - ensure it starts with /
                  if (!tilePath.startsWith("/")) {
                    tilePath = "/" + tilePath;
                  }

                  // Always use tile server URL
                  const finalUrl = `${tileServerUrl}${tilePath}`;

                  return finalUrl;
                });
              }
            });
          }

          // Convert relative glyphs URL to absolute URL
          if (styleJson.glyphs && typeof styleJson.glyphs === "string") {
            if (styleJson.glyphs.startsWith("/")) {
              styleJson.glyphs = `${tileServerUrl}${styleJson.glyphs}`;
            }
          } else if (
            styleJson.layers &&
            styleJson.layers.some(
              (layer: any) => layer.layout && layer.layout["text-field"],
            )
          ) {
            // If glyphs is missing but text layers exist, set default glyphs path
            styleJson.glyphs = `${tileServerUrl}/fonts/{fontstack}/{range}.pbf`;
          }

          // A custom base map may have taken over while this fetch was in
          // flight (e.g. a persisted raster set on startup) — don't clobber it.
          if (customBasemapActiveRef.current) return;
          // Apply the modified style.
          //
          // `{ diff: false }` is REQUIRED, not a tuning knob. mapbox's setStyle
          // defaults to diff:true, which takes Style._diffStyle → Style.setState:
          // that REMOVES every source/layer absent from the incoming style —
          // including our `raster-<layerId>` tiled rasters — and never emits
          // "style.load", because that event is only fired from Style._load (the
          // full-rebuild path). So on the diff path the uploaded rasters were
          // silently dropped and the re-attach listener below never ran; the only
          // way to get them back was mutating the layers array (e.g. toggling a
          // layer's visibility), which re-runs the attach effect directly.
          // diff:false forces the full load, so "style.load" fires and every
          // handler registered against it — the raster re-attach, the tile-URL
          // rewrite below — works as written.
          map.setStyle(styleJson, { diff: false });
        })
        .catch((error) => {
          console.error("[Map] Failed to fetch and apply style:", error);
          showTileDataError(
            `Map tile data not found at the expected location. Please ensure the ${TILES_FOLDER_NAME} folder is present in Documents/${TILES_FOLDER_NAME} on this device.`,
          );
        });
    } catch (error) {
      console.error("[Map] Error reloading style:", error);
    }

    map.once("style.load", () => {
      // Force update all tile source URLs to point to tile server
      const currentStyle = map.getStyle();
      // A real style with sources loaded → clear any spurious "not found" error.
      if (
        currentStyle?.sources &&
        Object.keys(currentStyle.sources).length > 0
      ) {
        setTileDataError(null);
      }
      if (currentStyle && currentStyle.sources) {
        Object.keys(currentStyle.sources).forEach((sourceKey) => {
          const source = map.getSource(sourceKey);
          if (source) {
            const sourceData = source as any;
            if (sourceData.type === "vector" && sourceData.tiles) {
              // Update tiles to point to tile server
              const updatedTiles = sourceData.tiles.map((tileUrl: string) => {
                let tilePath = tileUrl;

                // Extract path from absolute URL
                try {
                  const url = new URL(tilePath);
                  tilePath = url.pathname;
                } catch {
                  // Not a valid URL
                }

                // Handle template format
                if (
                  tilePath.includes("{z}") ||
                  tilePath.includes("{x}") ||
                  tilePath.includes("{y}")
                ) {
                  if (!tilePath.startsWith("/")) {
                    tilePath = "/" + tilePath;
                  }
                  return `${tileServerUrl}${tilePath}`;
                }

                // Regular path
                if (!tilePath.startsWith("/")) {
                  tilePath = "/" + tilePath;
                }

                return `${tileServerUrl}${tilePath}`;
              });

              // Update the source with new tile URLs
              try {
                map.removeSource(sourceKey);
                map.addSource(sourceKey, {
                  type: "vector",
                  tiles: updatedTiles,
                  minzoom: MAP_MIN_ZOOM,
                  // Native max: mapbox overzooms beyond it instead of 404-ing the
                  // missing higher zooms (which blanked the tiles). See constants.
                  maxzoom: TILE_SOURCE_MAX_NATIVE_ZOOM,
                });
              } catch (e) {
                console.error(`[Map] Failed to update source ${sourceKey}:`, e);
              }
            } else {
            }
          }
        });
      }
    });

    map.once("style.error", (e: any) => {
      console.error("[Map] Failed to reload style:", e);
      // Ignored if the map already has a working style (a later resource error over
      // a loaded map is not "map data not found").
      showTileDataError(
        "Failed to load map style. The tile data may be missing or corrupted at the expected location.",
      );
    });
  }, [tileServerUrl, vectorStyleNonce, showTileDataError]);

  // Apply the active custom base map (Storage Paths → Map Tiles → ✎). Inert while
  // activeId === null (built-in default vector) so the current basemap is untouched
  // until a folder is picked; then the folder's config.txt decides the render path.
  useEffect(() => {
    const wrap = mapRef.current;
    if (!wrap) return;
    const map = wrap.getMap?.();
    if (!map) return;

    const active =
      basemapActiveId != null
        ? (basemapSources.find((s) => s.id === basemapActiveId) ?? null)
        : null;

    let cancelled = false;

    // Leave geodetic mode, carrying the geodetic camera back to the mapbox map
    // (clamped to Mercator's ±85°) so the transition is seamless.
    const exitGeodetic = () => {
      if (!geodeticBasemapRef.current) return;
      const gv = geodeticViewRef.current;
      if (gv && map) {
        try {
          map.jumpTo({
            center: [gv.center[0], Math.max(-85, Math.min(85, gv.center[1]))],
            zoom: orthoZoomToMapbox(gv.zoom),
          });
        } catch {
          /* noop */
        }
      }
      applyGeodeticBasemap(null);
    };

    const apply = async () => {
      if (cancelled) return;

      // Revert to the built-in default vector base map.
      if (!active) {
        exitGeodetic();
        if (customBasemapActiveRef.current) {
          customBasemapActiveRef.current = false;
          await OfflineTileServer.basemapSetFolder({ path: "" }).catch(
            () => {},
          );
          setVectorStyleNonce((n) => n + 1); // re-runs the vector reload effect
        }
        return;
      }

      if (!tileServerUrl) return; // tile server not ready yet — effect re-runs

      // Point the /basemap/ route at the folder, then read its config from the
      // SERVED folder over HTTP. This works on BOTH Electron (abs path) and
      // Android (SAF tree URI), instead of a desktop-only direct file read.
      try {
        await OfflineTileServer.basemapSetFolder({ path: active.path });
      } catch (err) {
        console.error("[Basemap] setFolder failed:", err);
        toast.error(`Couldn't open ${active.label}`);
        return;
      }
      if (cancelled) return;

      const cfg = await resolveTilesConfig(`${tileServerUrl}/basemap`);
      if (cancelled) return;

      const kind = classifyTiles(cfg);

      // EPSG:4326 / plate-carrée — reaches the full ±90° (incl. 85–90°).
      if (kind === "raster-geodetic") {
        customBasemapActiveRef.current = true;
        // Seed the geodetic camera from the current mapbox view, but only when
        // ENTERING geodetic mode (not when switching between two 4326 folders).
        if (!geodeticBasemapRef.current) {
          let center: [number, number] = [DEFAULT_CENTER[0], DEFAULT_CENTER[1]];
          let oz = mapboxZoomToOrtho(DEFAULT_ZOOM);
          try {
            if (map) {
              const c = map.getCenter();
              center = [c.lng, c.lat];
              oz = mapboxZoomToOrtho(map.getZoom());
            }
          } catch {
            /* use defaults */
          }
          geodeticInitRef.current = { center, zoom: oz };
          geodeticViewRef.current = { center, zoom: oz };
        }
        applyGeodeticBasemap({
          config: cfg,
          baseUrl: `${tileServerUrl}/basemap`,
        });
        return;
      }

      // Non-geodetic target: leave geodetic mode if we were in it.
      exitGeodetic();

      // Vector (.pbf) folder — load its own style.json through /basemap/.
      if (kind === "vector-mercator") {
        customBasemapActiveRef.current = true;
        const ok = await applyVectorBasemap(
          map,
          `${tileServerUrl}/basemap`,
          active.id,
        );
        if (cancelled) return;
        if (!ok) {
          customBasemapActiveRef.current = false;
          setVectorStyleNonce((n) => n + 1); // fall back to the default vector map
          toast.error(`${active.label} has no usable style.json.`);
        }
        return;
      }

      // raster-mercator: render as a mapbox raster style from /basemap/.
      // `{ diff: false }` for the same reason as the default-style apply above:
      // the diff path drops our tiled-raster sources/layers and never fires
      // "style.load", so the uploaded rasters vanish until something else
      // mutates the layers array.
      customBasemapActiveRef.current = true;
      map.setStyle(buildRasterMercatorStyle(tileServerUrl, cfg, active.id), {
        diff: false,
      });
    };

    // Apply immediately. Gating on map.loaded()/the 'load' event misses the
    // common startup case where the SAVED basemap rehydrates AFTER the initial
    // load event already fired — the map would then never switch on launch. The
    // map object is usable once created (geodetic needs no mapbox call; setStyle/
    // jumpTo are safe any time), so a direct apply is correct.
    void apply();
    return () => {
      cancelled = true;
    };
  }, [
    basemapActiveId,
    basemapSources,
    tileServerUrl,
    applyGeodeticBasemap,
    mapLoaded,
  ]);

  // COMMENTED OUT: Not using HTML file input anymore - using NativeUploader directly
  // const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = async () => {
    if (isProcessingFiles) {
      return; // Prevent multiple uploads while processing
    }
    setIsProcessingFiles(true);
    const toastId = toast.loading("Opening file picker...");
    let progressListener: { remove: () => void } | null = null;
    let pickerClosedListener: { remove: () => void } | null = null;

    try {
      // Flip the overlay out of "Opening file picker…" the moment the
      // native dialog actually dismisses, even before any bytes have been
      // read. Without this, for large files the overlay appeared stuck on
      // "Opening file picker…" for many seconds while the native side was
      // actually already streaming the copy.
      try {
        pickerClosedListener = await NativeUploader.addListener(
          "pickerClosed",
          (event) => {
            if (event.count > 0) {
              toast.update(
                toastId,
                `Staging ${event.count} file(s)…`,
                "loading",
              );
            }
          },
        );
      } catch (listenerError) {
        console.warn(
          "[FileUpload] Failed to add pickerClosed listener:",
          listenerError,
        );
      }

      // Set up progress listener for upload
      let currentUploadProgress = 0;
      try {
        progressListener = await NativeUploader.addListener(
          "uploadProgress",
          (event) => {
            if (event.totalBytes > 0) {
              currentUploadProgress = Math.round(
                (event.bytesWritten / event.totalBytes) * 100,
              );

              toast.update(
                toastId,
                `Uploading File: ${currentUploadProgress}/100 %`,
                "loading",
              );
            } else {
              // Unknown size (content provider didn't report SIZE): at
              // least swap the message so the user sees activity.
              const mb = (event.bytesWritten / (1024 * 1024)).toFixed(1);
              toast.update(toastId, `Uploading file: ${mb} MB…`, "loading");
            }
          },
        );
      } catch (listenerError) {
        console.warn(
          "[FileUpload] Failed to add progress listener:",
          listenerError,
        );
        // Continue without progress listener
      }

      const result = await NativeUploader.pickAndStageMany({
        maxFiles: MAX_UPLOAD_FILES,
      });

      if (progressListener) {
        await progressListener.remove();
      }
      if (pickerClosedListener) {
        await pickerClosedListener.remove();
      }

      if (!result.files || result.files.length === 0) {
        toast.update(toastId, "No files selected", "error");
        return;
      }

      // Track if any files were actually valid
      let hasValidFiles = false;
      // Remember the reason the most-recent file was rejected so the
      // end-of-loop fallback toast can report something actionable instead
      // of the misleading "No valid files found" when every file hit a
      // specific gate (size cap, blocked extension, etc.).
      let lastRejectionMessage: string | null = null;

      // Per-type size caps (MB). Raster rasters are now aggressively
      // downsampled at decode time (GPU-safe 4096px cap), so a multi-gigabyte
      // GeoTIFF no longer blows up memory on the render side — the only real
      // cost is buffering the bytes once into an ArrayBuffer for the worker.
      // Desktop Electron (64-bit V8) handles ~2 GB comfortably; keep vectors
      // conservative since a 1 GB GeoJSON would be unusable anyway.
      const RASTER_SIZE_CAP_MB = 4096;
      const GENERIC_SIZE_CAP_MB = 4096;
      const rasterExtensionsForCap = new Set(["tif", "tiff", "hgt", "dett"]);
      const extOf = (name: string) => {
        const lower = name.toLowerCase();
        const dot = lower.lastIndexOf(".");
        return dot >= 0 ? lower.slice(dot + 1) : "";
      };

      // Process files sequentially
      for (let i = 0; i < result.files.length; i++) {
        const stagedFile = result.files[i];
        const fileNum = i + 1;

        try {
          // Step 1: Check if file extension is allowed
          const { isFileExtensionAllowed, getBlockedFileMessage } =
            await import("@/lib/allowed-file-extensions");
          if (!isFileExtensionAllowed(stagedFile.originalName)) {
            const msg = getBlockedFileMessage(stagedFile.originalName);
            lastRejectionMessage = msg;
            toast.update(toastId, msg, "error");
            continue; // Skip this file
          }

          // Don't set hasValidFiles here - only set it after successfully processing a file
          // This prevents empty ZIPs from being counted as valid

          // Step 2: Wait a bit for file to be fully written to disk
          await new Promise((resolve) => setTimeout(resolve, 500));

          // Step 3: Check file size before reading (prevent memory issues).
          // Rasters get a higher cap than other file types because the decoder
          // pipeline subsamples huge TIFFs at read time.
          const fileSizeMB = stagedFile.size / (1024 * 1024);
          const ext = extOf(stagedFile.originalName);
          const sizeCapMB = rasterExtensionsForCap.has(ext)
            ? RASTER_SIZE_CAP_MB
            : GENERIC_SIZE_CAP_MB;
          if (fileSizeMB > sizeCapMB) {
            const msg = `File ${
              stagedFile.originalName
            } is too large (${fileSizeMB.toFixed(
              2,
            )} MB). Maximum size is ${sizeCapMB} MB for ${
              rasterExtensionsForCap.has(ext) ? "raster" : "this file type"
            }.`;
            lastRejectionMessage = msg;
            toast.update(toastId, msg, "error");
            continue; // Skip this file
          }
          if (rasterExtensionsForCap.has(ext) && fileSizeMB > 1024) {
            // Inform the user that a very large TIFF may take longer — it's
            // still going to work, but the ArrayBuffer copy + worker transfer
            // is not instant at this size.
            toast.notification(
              `Large raster (${fileSizeMB.toFixed(
                0,
              )} MB). Processing may take up to a few minutes…`,
            );
          }

          // Step 3: Convert staged file to a File object — but skip the
          // binary read for tiled rasters. The gdal-async worker opens the
          // file by absolute path, so the renderer never needs the bytes.
          // (Without this guard, files >2 GB blow up Node's
          // ERR_FS_FILE_TOO_LARGE on fs:readFileBinary.)
          const stagedNameLower = stagedFile.originalName.toLowerCase();
          const isTiffExt =
            stagedNameLower.endsWith(".tif") ||
            stagedNameLower.endsWith(".tiff");
          const willTile = isTiffExt && shouldTile(stagedFile.size);

          let file: File = null as unknown as File;
          if (!willTile) {
            try {
              file = await Promise.race([
                stagedPathToFile({
                  absolutePath: stagedFile.absolutePath,
                  originalName: stagedFile.originalName,
                  mimeType: stagedFile.mimeType,
                }),
                new Promise<never>((_, reject) =>
                  setTimeout(
                    () => reject(new Error("File read timeout (30 seconds)")),
                    30000,
                  ),
                ),
              ]);
            } catch (fileError) {
              console.error("[FileUpload] Error reading file:", fileError);
              const errorMsg =
                fileError instanceof Error
                  ? fileError.message
                  : "Unknown error";
              const msg = `Error reading file ${stagedFile.originalName}: ${errorMsg}`;
              lastRejectionMessage = msg;
              toast.update(toastId, msg, "error");
              continue; // Skip this file and move to next
            }
          }

          // Step 4: Check if file is ZIP and handle accordingly
          const fileNameLower = stagedFile.originalName.toLowerCase();
          const isZip = fileNameLower.endsWith(".zip");

          if (isZip) {
            const extractToastId = toast.loading(
              `Extracting ZIP: ${stagedFile.originalName}...`,
            );

            // sketch_layers.zip: same bundle as session restore — do not extract as generic GIS
            if (
              fileBasenameLower(stagedFile.originalName) === "sketch_layers.zip"
            ) {
              try {
                const { importSketchLayersFromSketchZipBlob } =
                  await import("@/lib/autosave");
                const sketchLayers =
                  await importSketchLayersFromSketchZipBlob(file);
                const existingIds = new Set(layers.map((l) => l.id));
                let added = 0;
                for (const sl of sketchLayers) {
                  if (!existingIds.has(sl.id)) {
                    addLayer(sl);
                    existingIds.add(sl.id);
                    added++;
                  }
                }
                if (added > 0) {
                  toast.dismiss(extractToastId);
                  toast.success(`Loaded ${added} sketch layer(s)`);
                  hasValidFiles = true;
                } else {
                  toast.update(
                    extractToastId,
                    "No new sketch layers to add (empty file or duplicates skipped)",
                    "notification",
                  );
                }
              } catch (sketchErr) {
                toast.update(
                  extractToastId,
                  `Sketch ZIP: ${
                    sketchErr instanceof Error
                      ? sketchErr.message
                      : "Unknown error"
                  }`,
                  "error",
                );
              }
              try {
                await NativeUploader.deleteFile({
                  absolutePath: stagedFile.absolutePath,
                });
              } catch {
                /* ignore */
              }
              continue;
            }

            try {
              // Use native plugin to extract ZIP recursively
              const extractResult = await ZipFolder.extractZipRecursive({
                zipPath: stagedFile.absolutePath,
                outputDir: getHscFilesDir(),
              });

              if (extractResult.files.length === 0) {
                toast.dismiss(extractToastId);
                toast.update(
                  extractToastId,
                  "ZIP file is empty or contains no valid files. Only GIS-related files are allowed.",
                  "error",
                );
                // Don't mark as valid - continue to next file
                continue; // Skip this ZIP file
              }

              toast.update(
                extractToastId,
                `Found ${extractResult.files.length} file(s), processing...`,
                "loading",
              );

              // Track if any valid files were found in ZIP
              let hasValidFilesInZip = false;
              const sketchImportExistingIds = new Set(layers.map((l) => l.id));

              // Process each extracted file sequentially
              for (
                let zipFileIdx = 0;
                zipFileIdx < extractResult.files.length;
                zipFileIdx++
              ) {
                const extractedFile = extractResult.files[zipFileIdx];
                const zipFileNum = zipFileIdx + 1;

                if (
                  fileBasenameLower(extractedFile.name) === "sketch_layers.zip"
                ) {
                  const sketchToastId = toast.loading(
                    `Loading sketch layers (${extractedFile.name})...`,
                  );
                  try {
                    const sketchFile = await stagedPathToFile({
                      absolutePath: extractedFile.absolutePath,
                      originalName: extractedFile.name,
                      mimeType: "application/zip",
                    });
                    const { importSketchLayersFromSketchZipBlob } =
                      await import("@/lib/autosave");
                    const sketchLayers =
                      await importSketchLayersFromSketchZipBlob(sketchFile);
                    let added = 0;
                    for (const sl of sketchLayers) {
                      if (!sketchImportExistingIds.has(sl.id)) {
                        addLayer(sl);
                        sketchImportExistingIds.add(sl.id);
                        added++;
                      }
                    }
                    if (added > 0) {
                      toast.dismiss(sketchToastId);
                      toast.success(
                        `Loaded ${added} sketch layer(s) from ${extractedFile.name}`,
                      );
                      hasValidFilesInZip = true;
                      hasValidFiles = true;
                    } else {
                      toast.update(
                        sketchToastId,
                        "No new sketch layers (empty or duplicates)",
                        "notification",
                      );
                    }
                  } catch (nestedSketchErr) {
                    toast.update(
                      sketchToastId,
                      `Sketch ZIP ${extractedFile.name}: ${
                        nestedSketchErr instanceof Error
                          ? nestedSketchErr.message
                          : "Unknown error"
                      }`,
                      "error",
                    );
                  }
                  try {
                    await NativeUploader.deleteFile({
                      absolutePath: extractedFile.absolutePath,
                    });
                  } catch {
                    /* ignore */
                  }
                  continue;
                }

                // Check if extracted file extension is allowed
                const { isFileExtensionAllowed } =
                  await import("@/lib/allowed-file-extensions");
                if (!isFileExtensionAllowed(extractedFile.name)) {
                  // Delete the extracted file since we don't want to store it
                  try {
                    await NativeUploader.deleteFile({
                      absolutePath: extractedFile.absolutePath,
                    });
                  } catch (deleteError) {
                    console.warn(
                      `[FileUpload] Failed to delete blocked file: ${extractedFile.name}`,
                      deleteError,
                    );
                  }
                  continue; // Skip this file
                }

                hasValidFilesInZip = true; // Mark that we have at least one valid file in ZIP

                try {
                  // Add to manifest
                  const layerId = generateLayerId();
                  const layerName = extractedFile.name.split(".")[0];
                  await upsertManifestEntry({
                    layerId: layerId,
                    layerName: layerName,
                    path: `DOCUMENTS/${getHscFilesDir()}/${extractedFile.name}`,
                    absolutePath: extractedFile.absolutePath,
                    originalName: extractedFile.name,
                    size: extractedFile.size,
                    status: "staged",
                    type: extractedFile.type as "tiff" | "vector" | "shapefile",
                    createdAt: Date.now(),
                  });

                  // Create progress toast for this file
                  const progressToastId = toast.loading(
                    `Processing ${zipFileNum}/${extractResult.files.length}: ${extractedFile.name}...`,
                  );

                  // Defer stagedPathToFile() until we know we actually need
                  // the File object — for the tiling path we only need the
                  // absolute path. stagedPathToFile() on Electron calls
                  // fs.readFileBinary() which fails with ERR_FS_FILE_TOO_LARGE
                  // for files >2 GB (e.g. WB_2G_P1_2024_BestServerSS_GSM_M.tif
                  // at 3.4 GB). The tiling pipeline opens the file via GDAL
                  // mmap in the worker, so it doesn't need the bytes loaded.
                  const willTile =
                    extractedFile.type === "tiff" &&
                    shouldTile(extractedFile.size);
                  const file: File | null = willTile
                    ? null
                    : await stagedPathToFile({
                        absolutePath: extractedFile.absolutePath,
                        originalName: extractedFile.name,
                        mimeType:
                          extractedFile.type === "tiff"
                            ? "image/tiff"
                            : "application/octet-stream",
                      });

                  if (extractedFile.type === "tiff") {
                    if (shouldTile(extractedFile.size)) {
                      // Large raster from ZIP → on-demand tiling.
                      toast.update(
                        progressToastId,
                        `Tiling ${extractedFile.name}…`,
                        "loading",
                      );
                      const newLayer = await runTilingUpload(
                        {
                          layerId,
                          layerName,
                          absolutePath: extractedFile.absolutePath,
                        },
                        {
                          onPhase: (phase) => {
                            const msg =
                              phase === "probing"
                                ? `Probing ${extractedFile.name}…`
                                : phase === "optimizing"
                                  ? `Optimizing ${extractedFile.name} (one-time, may take a few minutes)…`
                                  : `Tiling ${extractedFile.name}…`;
                            toast.update(progressToastId, msg, "loading");
                          },
                        },
                      );
                      addLayer(newLayer);
                      const { updateManifestColor, upsertTempManifestEntry } =
                        await import("@/sessions/manifestStore");
                      await updateManifestColor(layerId, newLayer.color);
                      await upsertTempManifestEntry({
                        layerId,
                        layerName,
                        path: `DOCUMENTS/${getHscFilesDir()}/${extractedFile.name}`,
                        absolutePath: extractedFile.absolutePath,
                        originalName: extractedFile.name,
                        size: extractedFile.size,
                        status: "staged",
                        type: "tiff",
                        createdAt: Date.now(),
                        tileSourcePath: extractedFile.absolutePath,
                        tileMinZoom: newLayer.tileMinZoom,
                        tileMaxZoom: newLayer.tileMaxZoom,
                        tileBoundsWgs84: newLayer.tileBoundsWgs84,
                        sourceCrs: newLayer.sourceCrs,
                        sourceDtype: newLayer.sourceDtype,
                      });
                      // Don't claim "tiled" yet — wait for actual tiles to
                      // hit the canvas before flipping the toast to success.
                      waitAndAckTiledLayer(
                        layerId,
                        extractedFile.name,
                        progressToastId,
                      );
                    } else {
                      // Process DEM file (small TIFF — file was loaded above
                      // because willTile is false in this branch).
                      if (!file)
                        throw new Error(
                          "Internal: file not loaded for DEM path",
                        );
                      const demResult = await parseDemFile(file, {
                        layerId: layerId,
                        layerName: layerName,
                        onProgress: (percent) => {
                          toast.update(
                            progressToastId,
                            `Processing ${zipFileNum}/${extractResult.files.length}: ${extractedFile.name} (${percent}%)`,
                            "loading",
                          );
                        },
                      });

                      const newLayer = createDemLayer(demResult, {
                        layerId: layerId,
                        layerName: layerName,
                      });
                      addLayer(newLayer);
                      // Update manifest with layer color
                      const { updateManifestColor } =
                        await import("@/sessions/manifestStore");
                      await updateManifestColor(layerId, newLayer.color);

                      toast.update(
                        progressToastId,
                        `DEM: ${extractedFile.name}`,
                        "success",
                      );
                    }
                    hasValidFiles = true; // Mark that we have at least one valid file overall
                  } else if (
                    extractedFile.type === "vector" ||
                    extractedFile.type === "shapefile"
                  ) {
                    // Process vector file (file was loaded above because
                    // willTile is only true for the tiff branch).
                    if (!file)
                      throw new Error(
                        "Internal: file not loaded for vector path",
                      );
                    const vectorResult = await parseVectorFile(file, {
                      layerId: layerId,
                      layerName: layerName,
                      generateRandomColor,
                      onProgress: (percent) => {
                        toast.update(
                          progressToastId,
                          `Processing ${zipFileNum}/${extractResult.files.length}: ${extractedFile.name} (${percent}%)`,
                          "loading",
                        );
                      },
                    });

                    const newLayer = createVectorLayer(vectorResult, {
                      layerId: layerId,
                      layerName: layerName,
                      generateRandomColor,
                    });
                    addLayer(newLayer);
                    // Update manifest with layer color
                    const { updateManifestColor } =
                      await import("@/sessions/manifestStore");
                    await updateManifestColor(layerId, newLayer.color);

                    toast.update(
                      progressToastId,
                      `Vector: ${extractedFile.name}`,
                      "success",
                    );
                    hasValidFiles = true; // Mark that we have at least one valid file overall
                  }

                  // Small delay between files
                  await new Promise((resolve) => setTimeout(resolve, 100));
                } catch (fileError) {
                  console.error(
                    `[FileUpload] Error processing extracted file ${extractedFile.name}:`,
                    fileError,
                  );
                  toast.error(
                    `Error processing ${extractedFile.name}: ${
                      fileError instanceof Error
                        ? fileError.message
                        : "Unknown error"
                    }`,
                  );
                }
              }

              // Check if ZIP contained any valid files
              if (!hasValidFilesInZip) {
                toast.dismiss(extractToastId);
                toast.update(
                  extractToastId,
                  "ZIP file contains no valid files. Only GIS-related files are allowed.",
                  "error",
                );
                continue; // Skip to next file
              }

              // Only show success if we actually processed valid files
              if (hasValidFilesInZip) {
                toast.dismiss(extractToastId);
                toast.success(
                  `Successfully processed files from ZIP: ${stagedFile.originalName}`,
                );
              }

              // Delete the original ZIP file after extraction
              try {
                await NativeUploader.deleteFile({
                  absolutePath: stagedFile.absolutePath,
                });
              } catch (deleteError) {
                console.warn(
                  `[FileUpload] Failed to delete original ZIP file:`,
                  deleteError,
                );
              }
            } catch (zipError) {
              console.error(
                `[FileUpload] Error extracting ZIP file:`,
                zipError,
              );
              toast.dismiss(extractToastId);
              toast.update(
                extractToastId,
                `Error extracting ZIP: ${
                  zipError instanceof Error ? zipError.message : "Unknown error"
                }`,
                "error",
              );
              // Don't mark as valid - continue to next file
              continue; // Skip this ZIP file on error
            }
          } else {
            // Handle regular (non-ZIP) file
            // Add to manifest first (before parsing to avoid losing track if parsing fails)
            const layerId = generateLayerId();
            const layerName = stagedFile.originalName.split(".")[0];
            const logicalPath = stagedFile.logicalPath;
            const manifestEntry: ManifestEntry = {
              layerId,
              layerName,
              path: logicalPath,
              absolutePath: stagedFile.absolutePath,
              originalName: stagedFile.originalName,
              mimeType: stagedFile.mimeType,
              size: stagedFile.size,
              status: "staged",
              createdAt: Date.now(),
            };

            try {
              await upsertManifestEntry(manifestEntry);
            } catch (manifestError) {
              console.error(
                `[FileUpload] Error adding to manifest:`,
                manifestError,
              );
              toast.update(
                toastId,
                `Error adding file to manifest: ${
                  manifestError instanceof Error
                    ? manifestError.message
                    : "Unknown error"
                }`,
                "error",
              );
              // Continue - still try to render the file even if manifest fails
            }

            const vectorExtensions = [
              "geojson",
              "json",
              "csv",
              "gpx",
              "kml",
              "kmz",
              "wkt",
              "shp",
            ];
            const rasterExtensions = ["tif", "tiff", "hgt", "dett"];

            let ext = "";
            if (fileNameLower.endsWith(".geojson")) {
              ext = "geojson";
            } else if (
              fileNameLower.endsWith(".tiff") ||
              fileNameLower.endsWith(".tif")
            ) {
              ext = fileNameLower.endsWith(".tiff") ? "tiff" : "tif";
            } else {
              const parts = fileNameLower.split(".");
              ext = parts.length > 1 ? parts[parts.length - 1] : "";
            }

            const isRaster = rasterExtensions.includes(ext);
            const isVector = vectorExtensions.includes(ext);

            if (!isRaster && !isVector) {
              const msg = `Unsupported file type: ${ext}`;
              console.error(`[FileUpload] ${msg}`);
              lastRejectionMessage = msg;
              toast.update(toastId, msg, "error");
              continue;
            }

            const renderToastId = toast.loading(
              `Rendering File ${fileNum} (${stagedFile.originalName}): 0/100 %`,
            );
            // The tiled-raster path hands this toast to `waitAndAckTiledLayer`,
            // which keeps it in "Tiling…" until mapbox has actually drawn tiles.
            // The success/dismiss tail below must then NOT touch it, or it
            // overwrites and dismisses the toast a second owner is still driving —
            // which is why large rasters showed no progress at all: the phase
            // messages were replaced by "File Rendered Successfully" and gone 1 s
            // later, while the tiles were still rendering.
            let toastOwnedByTiling = false;

            try {
              if (isRaster) {
                if (shouldTile(stagedFile.size)) {
                  // Large raster (>300 MB) → on-demand tiling via gdal-async
                  // child worker. parseDemFile is skipped entirely; the layer
                  // gets a `tilesUrl` instead of a bitmap.
                  toast.update(
                    renderToastId,
                    `Tiling ${stagedFile.originalName}…`,
                    "loading",
                  );
                  const newLayer = await runTilingUpload(
                    {
                      layerId,
                      layerName,
                      absolutePath: stagedFile.absolutePath,
                    },
                    {
                      onPhase: (phase) => {
                        const msg =
                          phase === "probing"
                            ? `Probing ${stagedFile.originalName}…`
                            : phase === "optimizing"
                              ? `Optimizing ${stagedFile.originalName} (one-time, may take a few minutes)…`
                              : `Tiling ${stagedFile.originalName}…`;
                        toast.update(renderToastId, msg, "loading");
                      },
                    },
                  );
                  addLayer(newLayer);
                  const { updateManifestColor, upsertTempManifestEntry } =
                    await import("@/sessions/manifestStore");
                  await updateManifestColor(layerId, newLayer.color);
                  await upsertTempManifestEntry({
                    ...manifestEntry,
                    type: "tiff",
                    tileSourcePath: stagedFile.absolutePath,
                    tileMinZoom: newLayer.tileMinZoom,
                    tileMaxZoom: newLayer.tileMaxZoom,
                    tileBoundsWgs84: newLayer.tileBoundsWgs84,
                    sourceCrs: newLayer.sourceCrs,
                    sourceDtype: newLayer.sourceDtype,
                  });
                  // Don't claim success yet — keep the toast in "Tiling…"
                  // state until Mapbox has actually drawn the visible tiles.
                  // Deliberately not awaited; it owns the toast from here on.
                  toastOwnedByTiling = true;
                  waitAndAckTiledLayer(
                    layerId,
                    stagedFile.originalName,
                    renderToastId,
                  );
                } else {
                  const demResult = await parseDemFile(file, {
                    layerId,
                    layerName,
                    onProgress: (percent) => {
                      toast.update(
                        renderToastId,
                        `Rendering File ${fileNum} (${stagedFile.originalName}): ${percent}/100 %`,
                        "loading",
                      );
                    },
                  });
                  const newLayer = createDemLayer(demResult, {
                    layerId,
                    layerName,
                  });
                  addLayer(newLayer);
                  // Update manifest with layer color
                  const { updateManifestColor } =
                    await import("@/sessions/manifestStore");
                  await updateManifestColor(layerId, newLayer.color);
                }
              } else {
                const featureCollection = await parseVectorFile(file, {
                  layerId,
                  layerName,
                  generateRandomColor,
                  onProgress: (percent) => {
                    toast.update(
                      renderToastId,
                      `Rendering File ${fileNum} (${stagedFile.originalName}): ${percent}/100 %`,
                      "loading",
                    );
                  },
                });
                const newLayer = createVectorLayer(featureCollection, {
                  layerId,
                  layerName,
                  generateRandomColor,
                });
                addLayer(newLayer);
                // Update manifest with layer color
                const { updateManifestColor } =
                  await import("@/sessions/manifestStore");
                await updateManifestColor(layerId, newLayer.color);
              }

              hasValidFiles = true; // Mark that we have at least one valid file
              // Leave the toast alone when the tiling path owns it — otherwise
              // this relabels "Tiling…"/"Optimizing…" to success and dismisses it
              // 1 s later, while the tiles are still being rendered.
              if (!toastOwnedByTiling) {
                toast.update(
                  renderToastId,
                  "File Rendered Successfully",
                  "success",
                );
                await new Promise((resolve) => setTimeout(resolve, 1000));
                toast.dismiss(renderToastId);
              }
            } catch (renderError) {
              console.error("[FileUpload] Error rendering file:", renderError);
              const renderMsg = `Error rendering ${stagedFile.originalName}: ${
                renderError instanceof Error
                  ? renderError.message
                  : "Unknown error"
              }`;
              lastRejectionMessage = renderMsg;
              toast.update(renderToastId, renderMsg, "error");
              // Don't throw - continue with next file
            }
          }
        } catch (fileError) {
          console.error(
            `[FileUpload] Error processing file ${fileNum}:`,
            fileError,
          );
          const procMsg = `Error processing file ${fileNum}: ${
            fileError instanceof Error ? fileError.message : "Unknown error"
          }`;
          lastRejectionMessage = procMsg;
          toast.update(toastId, procMsg, "error");
          // Continue with next file
        }
      }

      // Check if any files were actually valid. If not, surface the most
      // recent specific rejection reason (size cap, blocked extension, etc.)
      // so the user understands why — the generic "only GIS files allowed"
      // message was misleading when a valid TIFF was rejected for size.
      if (!hasValidFiles) {
        toast.update(
          toastId,
          lastRejectionMessage ??
            "No valid files found. Only GIS-related files are allowed.",
          "error",
        );
        return;
      }

      toast.update(
        toastId,
        `Successfully uploaded and rendered file(s)`,
        "success",
      );
    } catch (error) {
      console.error("[FileUpload] Error:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";

      // Check if user cancelled - show notification toast instead of error
      if (
        errorMessage.toLowerCase().includes("user cancelled") ||
        errorMessage.toLowerCase().includes("user canceled") ||
        errorMessage.toLowerCase().includes("cancelled") ||
        errorMessage.toLowerCase().includes("canceled")
      ) {
        toast.update(toastId, "File selection cancelled", "notification");
        // Auto-dismiss notification toast after 5 seconds
        setTimeout(() => {
          toast.dismiss(toastId);
        }, 5000);
      } else {
        toast.update(toastId, `Error: ${errorMessage}`, "error");
      }
    } finally {
      // Always try to remove progress listener if it exists
      if (progressListener) {
        try {
          progressListener.remove();
        } catch (removeError) {
          console.warn(
            "[FileUpload] Error removing progress listener in finally:",
            removeError,
          );
        }
      }
      if (pickerClosedListener) {
        try {
          pickerClosedListener.remove();
        } catch (removeError) {
          console.warn(
            "[FileUpload] Error removing pickerClosed listener in finally:",
            removeError,
          );
        }
      }
      // Always reset processing state
      setIsProcessingFiles(false);
    }
  };

  // Export layers based on tempManifest
  const handleExportLayers = async () => {
    setIsExporting(true);
    const toastId = toast.loading("Exporting layers...");
    try {
      // Get tempManifest and filter for staged/saved entries
      const { getTempManifest } = await import("@/sessions/manifestStore");
      const tempManifest = getTempManifest();
      const filesToExport = tempManifest.filter(
        (entry) => entry.status === "staged" || entry.status === "saved",
      );

      // Check if there's anything to export
      if (filesToExport.length === 0) {
        toast.update(toastId, "Nothing to download.", "error");
        return;
      }

      // Prepare manifest file entries for Android
      const manifestFiles = filesToExport.map((entry) => ({
        absolutePath: entry.absolutePath,
        originalName: entry.originalName,
        layerId: entry.layerId,
        layerName: entry.layerName,
        size: entry.size,
      }));

      // Call Android plugin to create ZIP
      const { ZipFolder } = await import("@/plugins/zip-folder");
      const result = await ZipFolder.zipManifestFiles({
        files: manifestFiles,
      });

      toast.update(
        toastId,
        `GIS data exported to Documents: ${result.fileName}`,
        "success",
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";

      if (errorMessage === "NOTHING_TO_DOWNLOAD") {
        toast.update(toastId, "Nothing to download.", "error");
      } else {
        toast.update(toastId, `Failed to export: ${errorMessage}`, "error");
      }
    } finally {
      setIsExporting(false);
    }
  };

  // Save session manually
  const handleSaveSession = async () => {
    const toastId = toast.loading("Saving session...");
    try {
      // Early validation: Check if there's anything to save
      const { getTempManifest } = await import("@/sessions/manifestStore");

      const tempManifest = getTempManifest();
      const sketchLayers = layers.filter(isSketchLayer);

      // If both tempManifest and sketch layers are empty, stop everything
      if (tempManifest.length === 0 && sketchLayers.length === 0) {
        toast.update(toastId, "Nothing to save", "error");
        return; // Early return - stops all further flow
      }

      // First, check if manifest exists and what it contains
      // const { loadManifest } = await import("@/sessions/manifestStore");
      // const beforeManifest = await loadManifest();

      // Step 7 & 8: Finalize manifest according to system design:
      // - Sort manifest by upload time (createdAt, oldest first)
      // - Upgrade "staged" files to "saved" status
      // - Delete "staged_delete" files from files folder
      // - Remove "staged_delete" entries from manifest
      const finalizedEntries = await finalizeSaveManifest();

      // Save sketch layers as ZIP file in HSC-SESSIONS/FILES folder
      // Note: sketchLayers already filtered above in early validation
      const { getHscFilesDir, HSC_DIRECTORY } =
        await import("@/sessions/constants");
      const { Filesystem } = await import("@capacitor/filesystem");
      const sketchLayersPath = `${getHscFilesDir()}/sketch_layers.zip`;

      if (sketchLayers.length > 0) {
        const { saveLayers } = await import("@/lib/autosave");
        await saveLayers(sketchLayers, sketchLayersPath, HSC_DIRECTORY);
      } else {
        try {
          await Filesystem.deleteFile({
            path: sketchLayersPath,
            directory: HSC_DIRECTORY,
          });
        } catch (error) {
          // File might not exist, which is fine
        }
      }

      if (finalizedEntries.length === 0 && sketchLayers.length === 0) {
        console.warn("[SessionSave] No files or sketch layers in session!");
      }

      toast.update(toastId, `Session saved successfully.`, "success");
    } catch (error) {
      console.error("[SessionSave] Error:", error);
      toast.update(
        toastId,
        `Failed to save session: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
        "error",
      );
    }
  };

  // Restore session manually (only when button is pressed)
  // Step 9: When user restores the session:
  // - Check manifest file
  // - Merge temp and stored manifest ensuring unique layer_id objects
  // - Restore "saved" files
  // - Restore sketch layers from ZIP
  const handleRestoreSession = async () => {
    if (isProcessingFiles) {
      return; // Prevent restore while processing
    }
    setIsProcessingFiles(true);
    const toastId = toast.loading("Restoring session...");
    try {
      // Restore: Merge temp manifest with stored manifest (ensures unique layer_id)
      const { restoreManifest } = await import("@/sessions/manifestStore");
      const mergedEntries = await restoreManifest();

      // Filter to only "saved" entries for rendering
      const savedEntries = mergedEntries.filter((x) => x.status === "saved");

      // Clear ALL current layers from UI - complete reset to saved state
      // Don't call deleteLayer() as it would delete "staged" files immediately
      // Just clear the UI - we'll restore everything from saved manifest

      setLayers([]); // Clear everything - complete reset

      // No existing layers after reset - all will be restored fresh
      const existingLayerIds = new Set<string>();

      // Restore layers from saved files (only if layer_id is unique)
      let restoredFileCount = 0;
      let restoredSketchCount = 0;
      for (let i = 0; i < savedEntries.length; i++) {
        const entry = savedEntries[i];

        // Skip if layer_id already exists (prevent duplicates)
        if (existingLayerIds.has(entry.layerId)) {
          continue;
        }

        const progressToastId = toast.loading(
          `Restoring File ${i + 1}/${savedEntries.length}: ${
            entry.originalName
          }`,
        );

        try {
          // Check if this is a shapefile ZIP (stored as ZIP with type="shapefile")
          // Regular ZIP files should have been extracted, but shapefile ZIPs are stored as-is
          const isShapefileZip =
            entry.originalName.toLowerCase().endsWith(".zip") &&
            entry.type === "shapefile";

          // Skip non-shapefile ZIP files (they should have been extracted)
          if (
            entry.originalName.toLowerCase().endsWith(".zip") &&
            !isShapefileZip
          ) {
            toast.dismiss(progressToastId);
            continue;
          }

          // Convert absolute path to File object — but skip the binary
          // read when this entry will go through the tiling path (the
          // gdal-async worker reads the file by absolute path, and Node's
          // fs:readFileBinary blows up on files >2 GB with
          // ERR_FS_FILE_TOO_LARGE — that's why the WB_2G 3.4 GB file was
          // being "skipped" during restore).
          const restoreNameLower = entry.originalName.toLowerCase();
          const restoreIsTiff =
            restoreNameLower.endsWith(".tif") ||
            restoreNameLower.endsWith(".tiff");
          const restoreWillTile =
            restoreIsTiff &&
            (entry.tileSourcePath !== undefined ||
              (typeof entry.size === "number" && shouldTile(entry.size)));

          let file: File = null as unknown as File;
          if (!restoreWillTile) {
            try {
              file = await stagedPathToFile({
                absolutePath: entry.absolutePath,
                originalName: entry.originalName,
                mimeType: entry.mimeType || "application/octet-stream",
              });
            } catch (fileError) {
              // Distinguish "missing" from "too large" so the user knows
              // why a particular entry got dropped.
              const reason =
                fileError instanceof Error &&
                /ERR_FS_FILE_TOO_LARGE/.test(fileError.message)
                  ? "file too large for this code path (>2 GB)"
                  : "file not found";
              console.warn(
                `[SessionRestore] Skipping ${entry.originalName} — ${reason} at ${entry.absolutePath}`,
              );
              toast.update(
                progressToastId,
                `Skipping ${entry.originalName} (${reason})`,
                "error",
              );
              await new Promise((resolve) => setTimeout(resolve, 1000));
              toast.dismiss(progressToastId);
              continue;
            }
          }

          // Determine file type
          const fileNameLower = entry.originalName.toLowerCase();
          const vectorExtensions = [
            "geojson",
            "json",
            "csv",
            "gpx",
            "kml",
            "kmz",
            "wkt",
            "shp",
            "zip",
          ];
          const rasterExtensions = ["tif", "tiff", "hgt", "dett"];

          let ext = "";
          if (fileNameLower.endsWith(".geojson")) {
            ext = "geojson";
          } else if (
            fileNameLower.endsWith(".tiff") ||
            fileNameLower.endsWith(".tif")
          ) {
            ext = fileNameLower.endsWith(".tiff") ? "tiff" : "tif";
          } else {
            const parts = fileNameLower.split(".");
            ext = parts.length > 1 ? parts[parts.length - 1] : "";
          }

          // Use type from manifest if available, otherwise determine from extension
          const isRaster =
            entry.type === "tiff" || rasterExtensions.includes(ext);
          const isVector =
            entry.type === "vector" || vectorExtensions.includes(ext);

          if (isRaster) {
            // Tiled (large) rasters: re-register with the tile server +
            // probe to rebuild the LayerProps. The original .tif on disk
            // is still there; we don't re-decode anything.
            if (
              entry.tileSourcePath ||
              (typeof entry.size === "number" && shouldTile(entry.size))
            ) {
              toast.update(
                progressToastId,
                `Restoring tiled raster ${i + 1}/${savedEntries.length}: ${entry.originalName}`,
                "loading",
              );
              const newLayer = await runTilingUpload({
                layerId: entry.layerId,
                layerName: entry.layerName,
                absolutePath: entry.absolutePath,
                color: entry.color,
              });
              if (entry.createdAt) {
                (newLayer as any).uploadedAt = entry.createdAt;
              }
              if (entry.color) {
                newLayer.color = entry.color;
              }
              addLayer(newLayer);
              existingLayerIds.add(entry.layerId);
              restoredFileCount++;
            } else {
              const demResult = await parseDemFile(file, {
                layerId: entry.layerId,
                layerName: entry.layerName,
                onProgress: (percent) => {
                  toast.update(
                    progressToastId,
                    `Restoring File ${i + 1}/${
                      savedEntries.length
                    }: ${percent}/100 %`,
                    "loading",
                  );
                },
              });
              const newLayer = createDemLayer(demResult, {
                layerId: entry.layerId,
                layerName: entry.layerName,
              });
              // Use createdAt from manifest instead of current time
              if (entry.createdAt) {
                (newLayer as any).uploadedAt = entry.createdAt;
              }
              // Use color from manifest if available
              if (entry.color) {
                newLayer.color = entry.color;
              }
              addLayer(newLayer);
              existingLayerIds.add(entry.layerId);
              restoredFileCount++;
            }
          } else if (isShapefileZip) {
            // Explicitly handle shapefile ZIPs using shpToGeoJSON

            toast.update(
              progressToastId,
              `Restoring Shapefile ${i + 1}/${savedEntries.length}: ${
                entry.originalName
              }...`,
              "loading",
            );
            const featureCollection = await shpToGeoJSON(file);
            const newLayer = createVectorLayer(featureCollection, {
              layerId: entry.layerId,
              layerName: entry.layerName,
              generateRandomColor,
            });
            // Use createdAt from manifest instead of current time
            if (entry.createdAt) {
              (newLayer as any).uploadedAt = entry.createdAt;
            }
            // Use color from manifest if available
            if (entry.color) {
              newLayer.color = entry.color;
            }
            addLayer(newLayer);
            existingLayerIds.add(entry.layerId);
            restoredFileCount++;
          } else if (isVector) {
            // Process regular vector files
            const featureCollection = await parseVectorFile(file, {
              layerId: entry.layerId,
              layerName: entry.layerName,
              generateRandomColor,
              onProgress: (percent) => {
                toast.update(
                  progressToastId,
                  `Restoring File ${i + 1}/${
                    savedEntries.length
                  }: ${percent}/100 %`,
                  "loading",
                );
              },
            });
            const newLayer = createVectorLayer(featureCollection, {
              layerId: entry.layerId,
              layerName: entry.layerName,
              generateRandomColor,
            });
            // Use createdAt from manifest instead of current time
            if (entry.createdAt) {
              (newLayer as any).uploadedAt = entry.createdAt;
            }
            // Use color from manifest if available
            if (entry.color) {
              newLayer.color = entry.color;
            }
            addLayer(newLayer);
            existingLayerIds.add(entry.layerId);
            restoredFileCount++;
          }
          toast.dismiss(progressToastId);
        } catch (error) {
          console.error(
            `[SessionRestore] Error restoring file ${entry.originalName}:`,
            error,
          );
          toast.update(
            progressToastId,
            `Error restoring ${entry.originalName}`,
            "error",
          );
        }
      }

      // Restore sketch layers from ZIP file
      // Note: All layers have already been cleared above, so no need to remove existing sketch layers

      try {
        const { getHscFilesDir, HSC_DIRECTORY: hscDir } =
          await import("@/sessions/constants");
        const { Filesystem, Encoding } = await import("@capacitor/filesystem");
        const sketchLayersPath = `${getHscFilesDir()}/sketch_layers.zip`;

        try {
          const result = await Filesystem.readFile({
            path: sketchLayersPath,
            directory: hscDir,
            encoding: Encoding.UTF8,
          });

          const content = result.data;
          if (content && typeof content === "string" && content.trim() !== "") {
            const binaryString = atob(content);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
              bytes[i] = binaryString.charCodeAt(i);
            }
            const blob = new Blob([bytes], { type: "application/zip" });

            const { importSketchLayersFromSketchZipBlob } =
              await import("@/lib/autosave");
            const sketchLayers =
              await importSketchLayersFromSketchZipBlob(blob);

            for (const sketchLayer of sketchLayers) {
              if (!existingLayerIds.has(sketchLayer.id)) {
                addLayer(sketchLayer);
                existingLayerIds.add(sketchLayer.id);
                restoredSketchCount++;
              }
            }
          }
        } catch {
          // Sketch layers file doesn't exist, which is fine
        }
      } catch (error) {
        console.warn(`[SessionRestore] Error restoring sketch layers:`, error);
      }

      const totalRestored = restoredFileCount + restoredSketchCount;
      if (totalRestored === 0 && savedEntries.length === 0) {
        toast.update(toastId, "No saved session data found", "error");
      } else {
        const parts: string[] = [];
        if (restoredFileCount > 0) {
          parts.push(`${restoredFileCount} file(s)`);
        }
        if (restoredSketchCount > 0) {
          parts.push(`${restoredSketchCount} sketch layer(s)`);
        }
        toast.update(
          toastId,
          `Restored ${parts.join(", ")} from session`,
          "success",
        );
      }
    } catch (error) {
      console.error("[SessionRestore] Error:", error);
      toast.update(
        toastId,
        `Failed to restore session: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
        "error",
      );
    } finally {
      setIsProcessingFiles(false);
    }
  };

  const handleFlushSession = async () => {
    const toastId = toast.loading("Clearing all session data...");
    try {
      // Release every Dataset held by the tiling backend before we try to
      // unlink the source `.tif`s. On Windows an open file handle blocks
      // unlink with EBUSY/EPERM; on Android, holding a GDAL Dataset open
      // pins the file descriptor in the same way.
      try {
        await RasterTiling.closeAll();
      } catch (err) {
        console.warn(
          "[FlushSession] RasterTiling.closeAll failed (continuing):",
          err,
        );
      }

      const { flushAllSessionFiles } = await import("@/lib/autosave");

      await flushAllSessionFiles();

      // Clear in-memory temp manifest
      const manifestStore = await import("@/sessions/manifestStore");
      const entries = manifestStore.getTempManifest();
      for (const e of [...entries]) {
        manifestStore.removeFromTempManifest(e.layerId);
      }

      // Clear layers from the map
      setLayers([]);
      // Drop any open tooltip — the layer it points at is gone now, so
      // without this it would linger as a floating empty tooltip.
      setHoverInfo(undefined);

      toast.update(toastId, "All session data cleared", "success");
    } catch (error) {
      console.error("[FlushSession] Error:", error);
      toast.update(
        toastId,
        `Failed to clear session: ${error instanceof Error ? error.message : "Unknown error"}`,
        "error",
      );
    }
  };

  // Reset to home view (India bounds with fixed zoom)
  const handleResetHome = () => {
    // Geodetic (EPSG:4326) mode: the mapbox camera is covered and inert, so a
    // map.easeTo does nothing visible. Command the OrthographicView instead (same
    // path as focus / rubber-band).
    if (geodeticBasemapRef.current) {
      setGeodeticCommand({
        center: [DEFAULT_CENTER[0], DEFAULT_CENTER[1]],
        zoom: mapboxZoomToOrtho(DEFAULT_ZOOM),
        nonce: (geodeticCmdNonceRef.current += 1),
      });
      return;
    }
    if (mapRef.current) {
      const map = mapRef.current.getMap();
      // Reset to initial view state with fixed zoom level
      map.easeTo({
        center: DEFAULT_CENTER,
        zoom: DEFAULT_ZOOM,
        pitch: 0,
        bearing: 0,
        duration: 1000,
      });
    }
  };

  // On-screen zoom +/- buttons. In geodetic (EPSG:4326) mode the mapbox camera is
  // covered and inert (map.easeTo does nothing visible), so command the
  // OrthographicView instead — same path as home / focus / location. Step by one
  // mapbox-zoom level about the CURRENT geodetic centre so it matches the Mercator
  // +/- feel; the geodetic view clamps the result to its valid range.
  const handleZoomIn = () => {
    if (geodeticBasemapRef.current) {
      const gv = geodeticViewRef.current;
      const nextZoom = Math.min(orthoZoomToMapbox(gv.zoom) + 1, MAP_MAX_ZOOM);
      setGeodeticCommand({
        center: gv.center,
        zoom: mapboxZoomToOrtho(nextZoom),
        nonce: (geodeticCmdNonceRef.current += 1),
      });
      return;
    }
    if (mapRef.current) {
      const map = mapRef.current.getMap();
      // Short ease so the discrete +/- step feels immediate. A longer animation
      // renders many intermediate fractional-zoom frames — extra work that makes
      // raster (png/jpg) basemaps feel sluggish to step through.
      map.easeTo({ zoom: map.getZoom() + 1, duration: 150 });
    }
  };

  const handleZoomOut = () => {
    if (geodeticBasemapRef.current) {
      const gv = geodeticViewRef.current;
      const nextZoom = Math.max(orthoZoomToMapbox(gv.zoom) - 1, MAP_MIN_ZOOM);
      setGeodeticCommand({
        center: gv.center,
        zoom: mapboxZoomToOrtho(nextZoom),
        nonce: (geodeticCmdNonceRef.current += 1),
      });
      return;
    }
    if (mapRef.current) {
      const map = mapRef.current.getMap();
      map.easeTo({ zoom: map.getZoom() - 1, duration: 150 });
    }
  };

  // Capture screenshot and save to gallery
  const handleCaptureScreenshot = async () => {
    // Only work on native platform
    if (!Capacitor.isNativePlatform()) {
      toast.error("Screenshot is only available on native platforms");
      return;
    }

    try {
      const toastId = toast.loading("Capturing screenshot...");
      const result = await Screenshot.captureAndSave();
      toast.dismiss(toastId);

      if (result.success) {
        toast.success("Screenshot saved to gallery!");
      } else {
        toast.error(result.error || "Failed to save screenshot");
      }
    } catch (error) {
      console.error("Screenshot error:", error);
      toast.error("Failed to capture screenshot");
    }
  };

  // Toggle user location visibility and focus to location when enabling
  const handleToggleUserLocation = async () => {
    const willShow = !showUserLocation;
    setShowUserLocation(willShow);

    // If disabling location, just return
    if (!willShow) {
      return;
    }

    // Recenter on the location. In geodetic (EPSG:4326) mode the mapbox camera is
    // covered and inert, so command the OrthographicView instead (like home/focus).
    const zoomToLocation = (lng: number, lat: number) => {
      if (geodeticBasemapRef.current) {
        setGeodeticCommand({
          center: [lng, lat],
          zoom: mapboxZoomToOrtho(GEOLOCATION_ZOOM),
          nonce: (geodeticCmdNonceRef.current += 1),
        });
        return;
      }
      const map = mapRef.current?.getMap();
      if (map) {
        map.easeTo({
          center: [lng, lat],
          zoom: GEOLOCATION_ZOOM,
          duration: 1500,
        });
      }
    };

    let toastId: string | null = null;

    try {
      // If we don't have location yet, fetch it and show loading toast
      if (!userLocation) {
        toastId = toast.loading("Fetching your location");

        // Request permissions first
        const permission = await Geolocation.requestPermissions();
        if (permission.location !== "granted") {
          if (toastId) toast.dismiss(toastId);
          toast.error("Location permission denied");
          setShowUserLocation(false);
          return;
        }

        // Get current position
        const position = await Geolocation.getCurrentPosition({
          enableHighAccuracy: true,
        });

        if (position?.coords) {
          const location = {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            accuracy: position.coords.accuracy || 0,
          };
          // Update location in store (this will trigger OfflineLocationTracker to start watching)
          setUserLocation(location);

          // Wait a bit for the location to be set in the store
          await new Promise((resolve) => setTimeout(resolve, 100));

          // Zoom to location with smooth animation
          zoomToLocation(location.lng, location.lat);

          // Dismiss loading toast and show success
          if (toastId) {
            toast.update(toastId, "Location found", "success");
          }
        }
      } else {
        // We already have location, just zoom to it smoothly
        zoomToLocation(userLocation.lng, userLocation.lat);
      }
    } catch (error: any) {
      console.error("Location error:", error);
      if (toastId) toast.dismiss(toastId);
      toast.error(error.message || "Failed to get location");
      setShowUserLocation(false);
    }
  };

  const measurementPreview = useMemo(() => {
    if (!isDrawing) return null;

    if (drawingMode === "polyline" && currentPath.length >= 1) {
      // Only use committed points (currentPath), not the preview mouse position
      // This ensures we only show segments that are actually drawn
      const path = [...currentPath];
      if (path.length < 2) return null;

      const segmentDistances = computeSegmentDistancesKm(path);
      // Filter out segments with zero or invalid distance
      const validSegments = segmentDistances
        .map((dist, idx) => ({
          label: `Segment ${idx + 1}`,
          lengthKm: dist,
        }))
        .filter(
          (segment) =>
            segment.lengthKm > 0 && Number.isFinite(segment.lengthKm),
        );

      const totalKm = validSegments.reduce(
        (sum, segment) => sum + segment.lengthKm,
        0,
      );

      return {
        type: "polyline" as const,
        segments: validSegments,
        totalKm,
      };
    }

    if (drawingMode === "polygon") {
      const path = [...pendingPolygonPoints];
      if (mousePosition) path.push(mousePosition);
      if (path.length < 3) return null;
      const closedPath = [...path, path[0]];
      const areaMeters = computePolygonAreaMeters([closedPath]);
      const perimeterMeters = computePolygonPerimeterMeters([closedPath]);
      return {
        type: "polygon" as const,
        areaMeters,
        perimeterMeters,
      };
    }

    return null;
  }, [
    isDrawing,
    drawingMode,
    currentPath,
    mousePosition,
    pendingPolygonPoints,
    computeSegmentDistancesKm,
  ]);

  const polylinePreviewStats = useMemo(() => {
    if (!measurementPreview || measurementPreview.type !== "polyline") {
      return null;
    }
    const segments = measurementPreview.segments ?? [];
    if (!segments.length) return null;
    const max = Math.max(...segments.map((segment) => segment.lengthKm));
    const min = Math.min(...segments.map((segment) => segment.lengthKm));
    const avg =
      segments.reduce((sum, segment) => sum + segment.lengthKm, 0) /
      segments.length;
    return {
      count: segments.length,
      max,
      min,
      avg,
    };
  }, [measurementPreview]);

  // useEffect(() => {
  //   const loadNodeData = async () => {
  //     try {
  //       const coordinates: Array<{ lat: number; lng: number }[]> = [];

  //       // Load JSON files for each of the 8 nodes
  //       for (let i = 1; i <= 8; i++) {
  //         try {
  //           const response = await fetch(`/node-data/node-${i}.json`);
  //           if (!response.ok) {
  //             console.warn(
  //               `Failed to load node-${i}.json:`,
  //               response.statusText
  //             );
  //             continue;
  //           }
  //           const data = await response.json();
  //           if (Array.isArray(data) && data.length > 0) {
  //             coordinates.push(data);
  //
  //           }
  //         } catch (error) {
  //           console.error(`Error loading node-${i}.json:`, error);
  //         }
  //       }

  //       // Store all coordinates for each node
  //       if (coordinates.length === 8) {
  //         setNodeCoordinatesData(coordinates);
  //       } else {
  //         console.warn("Expected 8 node files, found:", coordinates.length);
  //         if (coordinates.length > 0) {
  //           // Use what we have
  //           setNodeCoordinatesData(coordinates);
  //         }
  //       }
  //     } catch (error) {
  //       console.error("Error loading node data files:", error);
  //     }
  //   };

  //   loadNodeData();
  // }, []);

  const createPointLayer = (position: [number, number]) => {
    const newLayer: LayerProps = {
      type: "point",
      id: generateLayerId(),
      name: `Point ${layers.filter((l) => l.type === "point").length + 1}`,
      position,
      color: [59, 130, 246], // Beautiful blue color
      radius: 5,
      visible: true,
    };
    addLayer(newLayer);
    lastLayerCreationTimeRef.current = Date.now();
    setHoverInfo(undefined); // Clear tooltip when creating a layer
  };

  const closeRing = (path: [number, number][]) => {
    if (!path.length) return path;
    const first = path[0];
    const last = path[path.length - 1];
    if (first[0] === last[0] && first[1] === last[1]) return path;
    return [...path, first];
  };

  const getUnkinkedRings = (polygon?: [number, number][][]) => {
    const ring = closeRing(polygon?.[0] ?? []);
    if (!ring.length) return [];
    try {
      const feature = unkinkPolygon({
        type: "Feature",
        properties: {},
        geometry: { type: "Polygon", coordinates: [ring] },
      });
      return feature.features
        .filter((f) => f.geometry && f.geometry.type === "Polygon")
        .flatMap((f) =>
          (f.geometry as any).coordinates.map((coords: [number, number][]) =>
            closeRing(coords),
          ),
        );
    } catch {
      return [ring];
    }
  };

  const handlePolygonDrawing = (point: [number, number]) => {
    if (!isDrawing) {
      setCurrentPath([point]);
      setPendingPolygonPoints([point]);
      // Collapse the preview edge onto the placed point: touch / the geodetic view
      // have no pre-tap hover, so a stale mousePosition would draw a stray edge.
      setMousePosition(point);
      setIsDrawing(true);
      return;
    }

    const updatedPath = [...pendingPolygonPoints, point];
    setPendingPolygonPoints(updatedPath);
    setCurrentPath(updatedPath);
    setMousePosition(point);

    // Zoom-based close threshold. In geodetic mode `mapZoom` is the covered mapbox
    // map's STALE zoom, so use the OrthographicView's own zoom (converted to the
    // equivalent mapbox zoom) — otherwise the "tap near the first point to close"
    // distance is wrong and the polygon won't close (or closes too early).
    const effectiveZoom = geodeticBasemapRef.current
      ? orthoZoomToMapbox(geodeticViewRef.current.zoom)
      : mapZoom;
    const closeThreshold = getPolygonCloseThreshold(effectiveZoom);

    if (
      updatedPath.length >= 3 &&
      isPointNearFirstPoint(point, updatedPath[0], closeThreshold)
    ) {
      const closedPath = [...updatedPath.slice(0, -1), updatedPath[0]];
      const newLayer: LayerProps = {
        type: "polygon",
        id: generateLayerId(),
        name: `Polygon ${
          layers.filter((l) => l.type === "polygon").length + 1
        }`,
        polygon: [closedPath],
        color: [32, 32, 32, 180],
        visible: true,
      };
      addLayer(newLayer);
      lastLayerCreationTimeRef.current = Date.now();
      setHoverInfo(undefined); // Clear tooltip when creating a layer
      setCurrentPath([]);
      setPendingPolygonPoints([]);
      setIsDrawing(false);
    }
  };

  const finalizePolyline = useCallback(() => {
    if (!currentPath || currentPath.length < 2) {
      setCurrentPath([]);
      setIsDrawing(false);
      return;
    }

    const path = [...currentPath];
    const segmentDistancesKm = computeSegmentDistancesKm(path);
    const totalDistanceKm = segmentDistancesKm.reduce(
      (sum, dist) => sum + dist,
      0,
    );

    const newLayer: LayerProps = {
      type: "line",
      id: generateLayerId(),
      name: `Path ${
        layers.filter(
          (l) => l.type === "line" && !(l.name || "").includes("Connection"),
        ).length + 1
      }`,
      path,
      color: [68, 68, 68],
      lineWidth: 6,
      visible: false, // Hidden by default - user can toggle visibility in layers panel
      segmentDistancesKm,
      totalDistanceKm,
    };

    addLayer(newLayer);
    lastLayerCreationTimeRef.current = Date.now();
    setHoverInfo(undefined);
    setCurrentPath([]);
    setIsDrawing(false);
  }, [
    currentPath,
    computeSegmentDistancesKm,
    addLayer,
    layers,
    setCurrentPath,
    setIsDrawing,
    setHoverInfo,
  ]);

  const handlePolylineDrawing = useCallback(
    (point: [number, number]) => {
      if (!isDrawing) {
        setCurrentPath([point]);
        // Collapse the preview segment onto the placed point (see the azimuthal
        // handler): stops a stale mousePosition drawing a random segment on the
        // first tap on the geodetic view / touch.
        setMousePosition(point);
        setIsDrawing(true);
        return;
      }

      const lastPoint = currentPath[currentPath.length - 1];
      if (
        lastPoint &&
        arePointsClose(lastPoint, point) &&
        currentPath.length >= 2
      ) {
        finalizePolyline();
        return;
      }

      setCurrentPath([...currentPath, point]);
      setMousePosition(point); // keep the next segment collapsed until the cursor moves
    },
    [
      isDrawing,
      currentPath,
      setCurrentPath,
      setMousePosition,
      setIsDrawing,
      arePointsClose,
      finalizePolyline,
    ],
  );

  const handleAzimuthalDrawing = (point: [number, number]) => {
    if (!isDrawing) {
      setCurrentPath([point]);
      // Collapse the preview onto the just-placed center so a STALE mousePosition
      // (left over from a previous draw) can't flash a random north/azimuth line
      // for a frame. The geodetic view and touch have no pre-tap hover to refresh
      // it, unlike the mapbox mousemove handler — hence the blink was 4326-only.
      setMousePosition(point);
      setIsDrawing(true);
      return;
    }

    const center = currentPath[0];
    if (!center) {
      setIsDrawing(false);
      setCurrentPath([]);
      return;
    }

    const target = point;
    const distanceMeters = calculateDistanceMeters(center, target);
    const azimuthAngle = calculateBearingDegrees(center, target);
    const referenceDistance = Math.max(distanceMeters, 1000);
    const northPoint = destinationPoint(center, referenceDistance, 0);

    const azimuthCount = layers.filter((l) => l.type === "azimuth").length;
    const newLayer: LayerProps = {
      type: "azimuth",
      id: generateLayerId(),
      name: `Azimuth ${azimuthCount + 1}`,
      color: [59, 130, 246],
      visible: true,
      azimuthCenter: center,
      azimuthTarget: target,
      azimuthNorth: northPoint,
      azimuthAngleDeg: azimuthAngle,
      distanceMeters,
      lineWidth: 6,
    };

    addLayer(newLayer);
    lastLayerCreationTimeRef.current = Date.now();
    setHoverInfo(undefined);
    setCurrentPath([]);
    setIsDrawing(false);
  };

  useEffect(() => {
    const previousMode = previousDrawingModeRef.current;
    if (
      previousMode === "polygon" &&
      drawingMode !== "polygon" &&
      pendingPolygonPoints.length >= 3
    ) {
      const closedPath = [...pendingPolygonPoints, pendingPolygonPoints[0]];
      const newLayer: LayerProps = {
        type: "polygon",
        id: generateLayerId(),
        name: `Polygon ${
          layers.filter((l) => l.type === "polygon").length + 1
        }`,
        polygon: [closedPath],
        color: [32, 32, 32, 180],
        visible: false, // Hidden by default - user can toggle visibility in layers panel
      };
      addLayer(newLayer);
      lastLayerCreationTimeRef.current = Date.now();
      setHoverInfo(undefined); // Clear tooltip when creating a layer
      setPendingPolygonPoints([]);
      setCurrentPath([]);
      setIsDrawing(false);
    }

    // Clear polygon points if exiting with less than 3 points
    if (
      previousMode === "polygon" &&
      drawingMode !== "polygon" &&
      pendingPolygonPoints.length > 0 &&
      pendingPolygonPoints.length < 3
    ) {
      setPendingPolygonPoints([]);
      setCurrentPath([]);
    }

    if (
      previousMode === "polygon" &&
      drawingMode !== "polygon" &&
      pendingPolygonPoints.length === 0 &&
      currentPath.length > 0
    ) {
      setCurrentPath([]);
    }

    // Clear polyline path if exiting with less than 2 points
    if (
      previousMode === "polyline" &&
      drawingMode !== "polyline" &&
      currentPath.length > 0 &&
      currentPath.length < 2
    ) {
      setCurrentPath([]);
    }

    if (
      previousMode === "polyline" &&
      drawingMode !== "polyline" &&
      currentPath.length >= 2
    ) {
      finalizePolyline();
    }

    // Clear azimuth path if exiting with any points
    if (
      previousMode === "azimuthal" &&
      drawingMode !== "azimuthal" &&
      currentPath.length > 0
    ) {
      setCurrentPath([]);
      setIsDrawing(false);
    }

    // Initialize state when entering azimuth mode (clear any leftover state)
    if (
      previousMode !== "azimuthal" &&
      drawingMode === "azimuthal" &&
      (currentPath.length > 0 || isDrawing)
    ) {
      setCurrentPath([]);
      setIsDrawing(false);
    }

    previousDrawingModeRef.current = drawingMode;
  }, [
    drawingMode,
    pendingPolygonPoints,
    addLayer,
    layers,
    setPendingPolygonPoints,
    setCurrentPath,
    setIsDrawing,
    currentPath,
    finalizePolyline,
    isDrawing,
  ]);

  /** Shared by per-layer `onHover` and map `click` pick (touch tap-to-inspect). */
  const commitDeckPickToHover = useCallback(
    (info: PickingInfo<unknown> | null | undefined) => {
      // While the Route Finder is waiting for an A/B point, the map is a picker —
      // every tap means "put the endpoint here". Opening a feature tooltip on those
      // taps (or on the hover that precedes them) fights the placement and leaves a
      // panel covering the very spot being aimed at. `handleMapClick` already
      // returns early for the placement itself, but deck's per-layer onHover fires
      // independently, which is how a tooltip still appeared while marking A.
      // Same treatment `drawingMode` already gets.
      if (routePickActiveRef.current) {
        setHoverInfo(undefined);
        return;
      }

      // Prevent tooltip from showing immediately after layer creation (especially on tablets)
      const timeSinceLastCreation =
        Date.now() - lastLayerCreationTimeRef.current;
      if (timeSinceLastCreation < 500) {
        setHoverInfo(undefined);
        return;
      }

      if (!info) {
        setHoverInfo(undefined);
        return;
      }

      const deckLayerId = (info.layer as any)?.id as string | undefined;

      // Special handling for DEM BitmapLayers (.tif, .tiff, .dett, .hgt)
      // BitmapLayer hover info often has no `object`, but we still want a tooltip
      let isDemHover = false;
      if (deckLayerId) {
        const baseId = deckLayerId
          .replace(/-icon-layer$/, "")
          .replace(/-signal-overlay$/, "")
          .replace(/-bitmap$/, "")
          .replace(/-mesh$/, "");

        const matchingLayer = layers.find((l) => l.id === baseId);
        if (matchingLayer?.type === "dem") {
          isDemHover = true;
        }
      }

      if (info.object || (isDemHover && info.coordinate)) {
        // In geodetic mode the pick comes from the OrthographicView; tag it so the
        // tooltip positions from the deck screen x/y instead of mapbox.project.
        if (geodeticBasemapRef.current) {
          (info as { __geodetic?: boolean }).__geodetic = true;
        }
        setHoverInfo(info);
      } else {
        setHoverInfo(undefined);
      }
    },
    [setHoverInfo, layers],
  );

  const handleLayerHover = useCallback(
    (info: PickingInfo<unknown>) => {
      commitDeckPickToHover(info);
    },
    [commitDeckPickToHover],
  );

  const handleClick = (event: any) => {
    if (!drawingMode) {
      return;
    }

    // Try to get coordinates from event.lngLat first
    let longitude: number | undefined;
    let latitude: number | undefined;

    if (event.lngLat) {
      longitude = event.lngLat.lng;
      latitude = event.lngLat.lat;
    } else if (event.point && mapRef.current) {
      // Fallback: unproject screen coordinates to geographic coordinates
      // This is needed when the map is tilted and lngLat might be undefined
      try {
        const map = mapRef.current.getMap();
        const coords = map.unproject(event.point);
        longitude = coords.lng;
        latitude = coords.lat;
      } catch (error) {
        console.error("Error unprojecting coordinates:", error);
        return;
      }
    } else {
      // If neither method works, return early
      console.warn("Could not determine click coordinates");
      return;
    }

    // Validate coordinates before proceeding
    if (
      typeof longitude !== "number" ||
      typeof latitude !== "number" ||
      isNaN(longitude) ||
      isNaN(latitude)
    ) {
      console.warn("Invalid coordinates:", { longitude, latitude });
      return;
    }

    // Reject clicks that resolve outside the valid Web Mercator world. When the map is
    // rotated/pitched, screen pixels in the surrounding whitespace void still unproject to
    // coordinates (latitudes up to ±90°, longitudes past ±180°); placing vertices there draws
    // off-world features. Keep drawing confined to the real map extent.
    // In geodetic (plate-carrée) mode the map reaches ±90°; only Mercator is
    // clipped at ±85.0511°.
    const drawMaxLat = geodeticBasemapRef.current ? 90 : MAX_MERCATOR_LATITUDE;
    if (Math.abs(latitude) > drawMaxLat || Math.abs(longitude) > 180) {
      toast.error("Can't draw outside the map area");
      return;
    }

    const clickPoint: [number, number] = [longitude, latitude];

    switch (drawingMode) {
      case "point":
        createPointLayer(clickPoint);
        break;
      case "polyline":
        handlePolylineDrawing(clickPoint);
        break;
      case "polygon":
        handlePolygonDrawing(clickPoint);
        break;
      case "azimuthal":
        handleAzimuthalDrawing(clickPoint);
        break;
    }
  };

  const handleMapClick = (event: any) => {
    const { object } = event;

    // Tooltip-on-leave fix for tiled rasters. deck.gl's per-layer onHover
    // doesn't fire on Android touch when the user taps OFF the layer, so a
    // stale hoverInfo from the previous tap on the raster keeps painting
    // an empty tooltip. react-map-gl's onClick fires on every tap (mouse
    // and touch), so it's the reliable hook to clear it.
    {
      const b = hoveredRasterBoundsRef.current;
      if (b) {
        const ll = event?.lngLat;
        const lng = Array.isArray(ll) ? ll[0] : ll?.lng;
        const lat = Array.isArray(ll) ? ll[1] : ll?.lat;
        if (
          typeof lng === "number" &&
          typeof lat === "number" &&
          (lng < b[0] || lng > b[2] || lat < b[1] || lat > b[3])
        ) {
          setHoverInfo(undefined);
        }
      }
    }

    // Route point placement takes priority when panel is open
    if (isRoutePanelOpen && routeState.graphReady && routeState.pickMode) {
      const lngLat = event.lngLat || event.coordinate;
      if (lngLat) {
        const lon = Array.isArray(lngLat)
          ? lngLat[0]
          : (lngLat.lng ?? lngLat[0]);
        const lat = Array.isArray(lngLat)
          ? lngLat[1]
          : (lngLat.lat ?? lngLat[1]);
        const coord: [number, number] = [lon, lat];

        if (routeState.pickMode === "A") {
          setRouteState((prev) => ({
            ...prev,
            pointA: coord,
            pathResult: null,
            error: null,
            pickMode: "B",
          }));
          dijkstraWorkerRef.current?.postMessage({
            type: "snap-point",
            lonLat: coord,
            tag: "A",
          });
        } else {
          setRouteState((prev) => ({
            ...prev,
            pointB: coord,
            pathResult: null,
            error: null,
            pickMode: null,
          }));
          dijkstraWorkerRef.current?.postMessage({
            type: "snap-point",
            lonLat: coord,
            tag: "B",
          });
        }
        return;
      }
    }

    // If clicking on empty space, close any open dialogs
    if (selectedNodeForIcon && !object) {
      setSelectedNodeForIcon(null);
    }

    // While drawing, keep clearing hover so tooltips don't fight with placement.
    if (drawingMode) {
      setHoverInfo(undefined);
      handleClick(event);
      return;
    }

    // In geodetic (EPSG:4326) mode the OrthographicView already resolved the pick
    // and passed the feature (+ layer) and the CORRECT lng/lat in the event. Its
    // camera differs from the covered, inert mapbox map, so the mapbox-overlay
    // re-pick below would sample the wrong pixel — anchoring the tooltip to the
    // wrong point (so it won't follow the feature) or missing entirely. Resolve
    // EVERYTHING from the geodetic pick here, for both vector features and rasters.
    if (geodeticBasemapRef.current) {
      const gx = event.point?.x ?? 0;
      const gy = event.point?.y ?? 0;
      const gLng = event.coordinate?.[0];
      const gLat = event.coordinate?.[1];
      if (object) {
        commitDeckPickToHover({
          object,
          layer: event.layer,
          coordinate: event.coordinate,
          x: gx,
          y: gy,
        } as unknown as PickingInfo<unknown>);
      } else if (typeof gLng === "number" && typeof gLat === "number") {
        // No vector object under the tap (e.g. a raster/DEM). Resolve the topmost
        // DEM by lng/lat — camera-independent, so it anchors to the right place and
        // the shared Tooltip then tracks it via the geodetic projection on pan/zoom.
        const topDem = resolveTopmostDemUnderLngLat(
          layers,
          getZoomVisibility,
          gLng,
          gLat,
        );
        if (topDem) {
          commitDeckPickToHover(
            syntheticDemPickingInfo(topDem, gLng, gLat, gx, gy),
          );
        } else {
          setHoverInfo(undefined);
        }
      } else {
        setHoverInfo(undefined);
      }
      return;
    }

    // Tap / click: Deck pick with DEM proxies temporarily removed from the picking
    // pass (hundreds of zip-imported rasters otherwise each participate in GPU pick).
    // If a vector/point wins, use it; else resolve the topmost DEM under lng/lat by bounds.
    try {
      const pt = event?.point;
      let px: number | undefined;
      let py: number | undefined;
      if (pt && typeof pt.x === "number" && typeof pt.y === "number") {
        px = pt.x;
        py = pt.y;
      } else if (Array.isArray(pt) && pt.length >= 2) {
        px = pt[0] as number;
        py = pt[1] as number;
      }
      let lng: number | undefined;
      let lat: number | undefined;
      const ll = event?.lngLat;
      if (ll && typeof ll.lng === "number" && typeof ll.lat === "number") {
        lng = ll.lng;
        lat = ll.lat;
      } else if (mapRef.current && pt) {
        try {
          const c = mapRef.current.getMap().unproject(pt);
          lng = c.lng;
          lat = c.lat;
        } catch {
          /* ignore */
        }
      }
      const overlay = deckOverlayRef.current;
      if (
        overlay &&
        px !== undefined &&
        py !== undefined &&
        Number.isFinite(px) &&
        Number.isFinite(py)
      ) {
        const coarse =
          typeof window !== "undefined" &&
          typeof window.matchMedia === "function" &&
          window.matchMedia("(pointer: coarse)").matches;
        demRasterPickSuppressRef.current = true;
        let picked: PickingInfo<unknown> | null = null;
        try {
          picked = overlay.pickObject({
            x: px,
            y: py,
            radius: coarse ? 28 : 12,
          });
        } finally {
          demRasterPickSuppressRef.current = false;
        }
        if (picked) {
          commitDeckPickToHover(picked);
        } else if (
          typeof lng === "number" &&
          typeof lat === "number" &&
          Number.isFinite(lng) &&
          Number.isFinite(lat)
        ) {
          const topDem = resolveTopmostDemUnderLngLat(
            layers,
            getZoomVisibility,
            lng,
            lat,
          );
          if (topDem) {
            commitDeckPickToHover(
              syntheticDemPickingInfo(topDem, lng, lat, px, py),
            );
          } else {
            setHoverInfo(undefined);
          }
        } else {
          setHoverInfo(undefined);
        }
      } else {
        setHoverInfo(undefined);
      }
    } catch {
      demRasterPickSuppressRef.current = false;
      setHoverInfo(undefined);
    }

    handleClick(event);
  };
  useEffect(() => {
    if (!focusLayerRequest || !mapRef.current) {
      return;
    }

    const map = mapRef.current.getMap();
    let [minLng, minLat, maxLng, maxLat] = focusLayerRequest.bounds;
    const { center, isSinglePoint } = focusLayerRequest;

    // Validate and clamp bounds to valid ranges
    const clampLng = (lng: number) => {
      if (!Number.isFinite(lng)) return 0;
      // Normalize longitude to [-180, 180]
      while (lng > 180) lng -= 360;
      while (lng < -180) lng += 360;
      return lng;
    };

    const clampLat = (lat: number) => {
      if (!Number.isFinite(lat)) return 0;
      // Clamp latitude to [-90, 90]
      return Math.max(-90, Math.min(90, lat));
    };

    // Geodetic (EPSG:4326) mode: the visible surface is the deck OrthographicView;
    // the mapbox map underneath is covered and inert. Driving it (fitBounds/flyTo)
    // does nothing visible AND makes the hidden map fetch pbf tiles as it pans, so
    // command the geodetic view directly instead.
    if (geodeticBasemapRef.current) {
      let orthoZoom: number;
      let cLng: number;
      let cLat: number;
      if (isSinglePoint) {
        cLng = clampLng(center[0]);
        cLat = clampLat(center[1]);
        orthoZoom = mapboxZoomToOrtho(12);
      } else {
        const bMinLng = clampLng(minLng);
        const bMaxLng = clampLng(maxLng);
        const bMinLat = clampLat(minLat);
        const bMaxLat = clampLat(maxLat);
        cLng = (bMinLng + bMaxLng) / 2;
        cLat = (bMinLat + bMaxLat) / 2;
        // Fit the bounds into the geodetic viewport (deck canvas ≈ map container).
        const el = map.getContainer?.();
        const W = Math.max(1, el?.clientWidth ?? 1);
        const H = Math.max(1, el?.clientHeight ?? 1);
        const lngSpan = Math.max(Math.abs(bMaxLng - bMinLng), 1e-4);
        const latSpan = Math.max(Math.abs(bMaxLat - bMinLat), 1e-4);
        const pad = 1.3; // leave a margin, approximating fitBounds padding
        orthoZoom = Math.min(
          Math.log2(W / (lngSpan * pad)),
          Math.log2(H / (latSpan * pad)),
          mapboxZoomToOrtho(20),
        );
      }
      setGeodeticCommand({
        center: [cLng, cLat],
        zoom: orthoZoom,
        nonce: (geodeticCmdNonceRef.current += 1),
      });
      setFocusLayerRequest(null);
      return;
    }

    minLng = clampLng(minLng);
    maxLng = clampLng(maxLng);
    minLat = clampLat(minLat);
    maxLat = clampLat(maxLat);

    // Ensure bounds are valid (min < max)
    if (minLng > maxLng) {
      // Handle case where bounds cross the antimeridian
      // For large areas, we'll use a safe fallback
      const lngSpan = maxLng + 360 - minLng;
      if (lngSpan > 180) {
        // Bounds are too large, use center with appropriate zoom
        const centerLng = clampLng((minLng + maxLng) / 2);
        const centerLat = (minLat + maxLat) / 2;
        const currentZoom = map.getZoom();
        map.easeTo({
          center: [centerLng, centerLat],
          zoom: Math.min(currentZoom, 3), // Zoom out for very large areas
          duration: 800,
        });
        setFocusLayerRequest(null);
        return;
      }
    }

    // Ensure minimum span to avoid division by zero in fitBounds
    const lngSpan = maxLng - minLng;
    const latSpan = maxLat - minLat;
    if (lngSpan < 0.0001) maxLng = minLng + 0.0001;
    if (latSpan < 0.0001) maxLat = minLat + 0.0001;

    try {
      const currentZoom = map.getZoom();
      const currentCenter = map.getCenter();
      const centerLng = clampLng(center[0]);
      const centerLat = clampLat(center[1]);

      // Check if we're already focused on this location (within small threshold)
      const centerDistance = Math.sqrt(
        Math.pow(currentCenter.lng - centerLng, 2) +
          Math.pow(currentCenter.lat - centerLat, 2),
      );

      if (isSinglePoint) {
        // For single point, check if already focused
        const targetZoom = Math.min(Math.max(currentZoom, 12), 12);
        const zoomDiff = Math.abs(currentZoom - targetZoom);
        const isAlreadyFocused = centerDistance < 0.001 && zoomDiff < 0.5;

        if (isAlreadyFocused) {
          setFocusLayerRequest(null);
          return;
        }

        // Use flyTo for single point
        map.flyTo({
          center: [centerLng, centerLat],
          zoom: targetZoom,
          duration: 2000,
          curve: 1.2,
          speed: 1.2,
          essential: true,
        });
      } else {
        // For bounds, check if current view already contains the bounds
        const currentBounds = map.getBounds();
        const boundsContained =
          currentBounds.getWest() <= minLng &&
          currentBounds.getEast() >= maxLng &&
          currentBounds.getSouth() <= minLat &&
          currentBounds.getNorth() >= maxLat;

        // Calculate zoom based on bounding box size
        // Smaller bounding box = higher zoom, larger bounding box = lower zoom
        const lngSpan = maxLng - minLng;
        const latSpan = maxLat - minLat;
        const maxSpan = Math.max(lngSpan, latSpan);

        // Calculate appropriate maxZoom based on bounding box size
        // Formula: smaller span = higher zoom (up to 20), larger span = lower zoom (down to 3)
        let calculatedMaxZoom: number;
        if (maxSpan < 0.001) {
          // Very small area - zoom in very high
          calculatedMaxZoom = 20;
        } else if (maxSpan < 0.01) {
          // Small area - zoom in high
          calculatedMaxZoom = 18;
        } else if (maxSpan < 0.1) {
          // Medium area - moderate zoom
          calculatedMaxZoom = 15;
        } else if (maxSpan < 1) {
          // Large area - lower zoom
          calculatedMaxZoom = 12;
        } else if (maxSpan < 10) {
          // Very large area - even lower zoom
          calculatedMaxZoom = 8;
        } else {
          // Extremely large area - very low zoom
          calculatedMaxZoom = 5;
        }

        const zoomDiff = Math.abs(currentZoom - calculatedMaxZoom);
        const isAlreadyFocused = boundsContained && zoomDiff < 1;

        if (isAlreadyFocused) {
          setFocusLayerRequest(null);
          return;
        }

        // Use fitBounds with smooth animation to show the entire bounding box
        // Stop any ongoing animations first to prevent jitter
        map.stop();
        map.fitBounds(
          [
            [minLng, minLat],
            [maxLng, maxLat],
          ],
          {
            padding: { top: 120, bottom: 120, left: 160, right: 160 },
            duration: 2000, // Smooth, slower duration
            maxZoom: calculatedMaxZoom, // Zoom based on bounding box size
            linear: false, // Use default easing (smooth)
          },
        );
      }
    } catch (error) {
      console.error("Failed to focus layer:", error);
      // Fallback: just center on the layer without zooming
      try {
        const centerLng = clampLng(center[0]);
        const centerLat = clampLat(center[1]);
        map.easeTo({
          center: [centerLng, centerLat],
          duration: 800,
        });
      } catch (fallbackError) {
        console.error("Fallback focus also failed:", fallbackError);
      }
    } finally {
      setFocusLayerRequest(null);
    }
  }, [focusLayerRequest]);

  // Close a UDP tooltip as soon as its subject stops arriving from the feed.
  //
  // Tap-to-inspect gets no deck onHover-leave event when an icon simply vanishes,
  // so the tooltip would otherwise sit there describing a plane that is no longer
  // being reported — with stale coordinates, and with no way to dismiss it except
  // tapping elsewhere.
  //
  // This used to cover ONLY `udp-topology-nodes-layer`, so network members
  // (planes), targets and topology links all kept their tooltips after the server
  // stopped sending them. Each UDP layer is checked against the live store slice
  // that feeds it. Being store-driven, this is basemap-independent — it behaves the
  // same on the default, custom-mercator and geodetic basemaps.
  useEffect(() => {
    const obj = hoverInfo?.object as
      | { globalId?: number; connectionKey?: string }
      | null
      | undefined;
    if (!obj) return;
    const layerId = hoverInfo?.layer?.id;
    if (typeof layerId !== "string" || !layerId.startsWith("udp-")) return;

    const stillPresent = (): boolean => {
      switch (layerId) {
        case "udp-topology-nodes-layer":
          return obj.globalId !== undefined && topologyNodes.has(obj.globalId);
        case "udp-topology-connections-layer":
          // Keyed by the connection id when we have one; otherwise fall back to
          // "are both endpoint nodes still live?".
          if (obj.connectionKey !== undefined) {
            return topologyConnections.has(obj.connectionKey);
          }
          {
            const link = obj as { fromId?: number; toId?: number };
            return (
              link.fromId !== undefined &&
              link.toId !== undefined &&
              topologyNodes.has(link.fromId) &&
              topologyNodes.has(link.toId)
            );
          }
        case "udp-network-members-layer":
          return (
            obj.globalId !== undefined &&
            udpNetworkMembers.some(
              (m: { globalId?: number }) => m?.globalId === obj.globalId,
            )
          );
        case "udp-targets-layer":
          return (
            obj.globalId !== undefined &&
            udpTargets.some(
              (t: { globalId?: number }) => t?.globalId === obj.globalId,
            )
          );
        default:
          // An unrecognised udp-* layer: leave it alone rather than guess.
          return true;
      }
    };

    if (!stillPresent()) {
      setHoverInfo(undefined);
    }
  }, [
    hoverInfo,
    topologyNodes,
    topologyConnections,
    udpNetworkMembers,
    udpTargets,
    setHoverInfo,
  ]);


  const handleMouseMove = (event: any) => {
    if (!event.lngLat) return;

    const { lng: longitude, lat: latitude } = event.lngLat;
    const currentPoint: [number, number] = [longitude, latitude];
    setMousePosition(currentPoint);

    // Update rubber band end point if drawing (for mouse/touch support)
    if (isRubberBandDrawing && rubberBandStart) {
      setRubberBandEnd([longitude, latitude]);
      // Force re-render by updating state
    }
  };

  const handleMouseUp = () => {
    if (!isDrawing || !dragStart) return;

    setIsDrawing(false);
    setDragStart(null);
  };

  // Handle mouse down for rubber band (for desktop testing and mouse support)
  const handleMouseDown = useCallback(
    (event: any) => {
      // Only activate when rubber band mode is on and no drawing mode is active
      if (!rubberBandMode || drawingMode || isDrawing) {
        return;
      }

      // Check if it's a left mouse button (not right click)
      if (
        event.originalEvent?.button !== 0 &&
        event.originalEvent?.button !== undefined
      ) {
        return;
      }

      const point = event.lngLat;
      if (!point) return;

      // Start rubber band selection
      setIsRubberBandDrawing(true);
      setRubberBandStart([point.lng, point.lat]);
      setRubberBandEnd([point.lng, point.lat]);
      setIsRubberBandZooming(false);

      // Prevent default map panning
      if (event.originalEvent) {
        event.originalEvent.preventDefault();
      }
    },
    [rubberBandMode, drawingMode, isDrawing],
  );

  // Handle mouse up for rubber band (for desktop testing)
  const handleMouseUpForRubberBand = useCallback(() => {
    if (!isRubberBandDrawing || !rubberBandStart || !rubberBandEnd) {
      return;
    }

    // Calculate minimum distance threshold (e.g., 0.001 degrees)
    const lngDiff = Math.abs(rubberBandEnd[0] - rubberBandStart[0]);
    const latDiff = Math.abs(rubberBandEnd[1] - rubberBandStart[1]);

    // Only zoom if selection is large enough (not just a click)
    if (lngDiff < 0.001 && latDiff < 0.001) {
      // Too small, cleanup
      setIsRubberBandDrawing(false);
      setRubberBandStart(null);
      setRubberBandEnd(null);
      return;
    }

    // Calculate bounding box
    const bounds = calculateRectangleBounds(rubberBandStart, rubberBandEnd);
    if (!bounds) {
      setIsRubberBandDrawing(false);
      setRubberBandStart(null);
      setRubberBandEnd(null);
      return;
    }

    // Start zoom phase
    setIsRubberBandDrawing(false);
    setIsRubberBandZooming(true);

    // Dismiss notification toast when rectangle is drawn
    if (rubberBandToastId) {
      toast.dismiss(rubberBandToastId);
      setRubberBandToastId(null);
    }

    // Zoom to selected area
    if (mapRef.current) {
      const map = mapRef.current.getMap();
      map.fitBounds(
        [
          [bounds.minLng, bounds.minLat],
          [bounds.maxLng, bounds.maxLat],
        ],
        {
          padding: { top: 50, bottom: 50, left: 50, right: 50 },
          duration: 500,
          maxZoom: 18,
        },
      );
    }
  }, [isRubberBandDrawing, rubberBandStart, rubberBandEnd, rubberBandToastId]);

  // Rubber band zoom handlers (rectangle-based)
  const handleTouchStart = useCallback(
    (event: any) => {
      // Only activate on Android tablets when rubber band mode is on and no drawing mode is active
      if (!isAndroidTablet || !rubberBandMode || drawingMode || isDrawing) {
        return;
      }

      // Check if it's a single touch (not multi-touch)
      const touches =
        event.originalEvent?.touches || event.nativeEvent?.touches;
      if (touches && touches.length !== 1) return;

      const point = event.lngLat;
      if (!point) return;

      // Start rubber band selection
      setIsRubberBandDrawing(true);
      setRubberBandStart([point.lng, point.lat]);
      setRubberBandEnd([point.lng, point.lat]);
      setIsRubberBandZooming(false);

      // Prevent default map panning
      if (event.originalEvent) {
        event.originalEvent.preventDefault();
      } else if (event.nativeEvent) {
        event.nativeEvent.preventDefault();
      }
    },
    [isAndroidTablet, rubberBandMode, drawingMode, isDrawing],
  );

  const handleTouchMove = useCallback(
    (event: any) => {
      if (!isRubberBandDrawing || !rubberBandStart) return;

      const point = event.lngLat;
      if (!point) return;

      // Update end point for rectangle
      setRubberBandEnd([point.lng, point.lat]);

      // Prevent default map panning
      if (event.originalEvent) {
        event.originalEvent.preventDefault();
      } else if (event.nativeEvent) {
        event.nativeEvent.preventDefault();
      }
    },
    [isRubberBandDrawing, rubberBandStart],
  );

  const handleTouchEnd = useCallback(
    (event: any) => {
      if (!isRubberBandDrawing || !rubberBandStart || !rubberBandEnd) {
        return;
      }

      // Calculate minimum distance threshold (e.g., 0.001 degrees)
      const lngDiff = Math.abs(rubberBandEnd[0] - rubberBandStart[0]);
      const latDiff = Math.abs(rubberBandEnd[1] - rubberBandStart[1]);

      // Only zoom if selection is large enough (not just a tap)
      if (lngDiff < 0.001 && latDiff < 0.001) {
        // Too small, cleanup
        setIsRubberBandDrawing(false);
        setRubberBandStart(null);
        setRubberBandEnd(null);
        return;
      }

      // Calculate bounding box
      const bounds = calculateRectangleBounds(rubberBandStart, rubberBandEnd);
      if (!bounds) {
        setIsRubberBandDrawing(false);
        setRubberBandStart(null);
        setRubberBandEnd(null);
        return;
      }

      // Start zoom phase
      setIsRubberBandDrawing(false);
      setIsRubberBandZooming(true);

      // Dismiss notification toast when rectangle is drawn
      if (rubberBandToastId) {
        toast.dismiss(rubberBandToastId);
        setRubberBandToastId(null);
      }

      // Zoom to selected area
      if (mapRef.current) {
        const map = mapRef.current.getMap();
        map.fitBounds(
          [
            [bounds.minLng, bounds.minLat],
            [bounds.maxLng, bounds.maxLat],
          ],
          {
            padding: { top: 50, bottom: 50, left: 50, right: 50 },
            duration: 500,
            maxZoom: 18,
          },
        );
      }

      // Prevent default
      if (event.originalEvent) {
        event.originalEvent.preventDefault();
      } else if (event.nativeEvent) {
        event.nativeEvent.preventDefault();
      }
    },
    [isRubberBandDrawing, rubberBandStart, rubberBandEnd, rubberBandToastId],
  );

  // Show notification toast when rubber band mode is enabled
  useEffect(() => {
    if (rubberBandMode) {
      const toastId = toast.notification("Drag to draw a rectangle");
      setRubberBandToastId(toastId);
    } else {
      // Dismiss toast when mode is disabled
      if (rubberBandToastId) {
        toast.dismiss(rubberBandToastId);
        setRubberBandToastId(null);
      }
    }
  }, [rubberBandMode]);

  // Cleanup rubber band when mode is disabled
  useEffect(() => {
    if (!rubberBandMode) {
      setIsRubberBandDrawing(false);
      setIsRubberBandZooming(false);
      setRubberBandStart(null);
      setRubberBandEnd(null);
    }
  }, [rubberBandMode]);

  // Cleanup rubber band when drawing mode is activated (disable rubber band mode)
  useEffect(() => {
    if (drawingMode) {
      setIsRubberBandDrawing(false);
      setIsRubberBandZooming(false);
      setRubberBandStart(null);
      setRubberBandEnd(null);
      // Disable rubber band mode when any drawing tool is activated
      setRubberBandMode(false);
    }
  }, [drawingMode]);

  // Listen for zoom completion to cleanup and exit mode
  useEffect(() => {
    if (!mapRef.current || !isRubberBandZooming) return;

    const map = mapRef.current.getMap();
    const handleMoveEnd = () => {
      // Small delay to ensure zoom animation is complete
      setTimeout(() => {
        // Cleanup all state and exit rubber band mode after zoom completes
        setIsRubberBandZooming(false);
        setRubberBandStart(null);
        setRubberBandEnd(null);
        setRubberBandMode(false); // Exit mode after one zoom
      }, 100);
    };

    map.on("moveend", handleMoveEnd);

    return () => {
      map.off("moveend", handleMoveEnd);
    };
  }, [isRubberBandZooming]);

  // Ensure we always hand BitmapLayer a canvas (avoid createImageBitmap on blob)
  const ensureCanvasImage = (img: any): HTMLCanvasElement | null => {
    if (img instanceof HTMLCanvasElement) return img;
    if (typeof ImageBitmap !== "undefined" && img instanceof ImageBitmap) {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(img, 0, 0);
        return canvas;
      }
    }
    return null;
  };

  // UDP layers from separate component
  const { udpLayers, connectionError, noDataWarning } =
    useUdpLayers(handleLayerHover);

  // Rubber band overlay layers
  const rubberBandRectangle = useRubberBandRectangle({
    isDrawing: isRubberBandDrawing,
    isZooming: isRubberBandZooming,
    start: rubberBandStart,
    end: rubberBandEnd,
  });

  const rubberBandOverlay = useRubberBandOverlay({
    isZooming: isRubberBandZooming,
    start: rubberBandStart,
    end: rubberBandEnd,
  });

  // UDP config store removed - port is now fixed at 40074

  // Debounced zoom: only updates 1 second after user stops zooming
  // This prevents visibility updates during active zooming
  const [debouncedZoom, setDebouncedZoom] = useState(mapZoom);

  useEffect(() => {
    // Clear any existing debounce timeout
    if (zoomDebounceTimeoutRef.current) {
      clearTimeout(zoomDebounceTimeoutRef.current);
    }

    // Set new timeout to update debouncedZoom after 1 second of no zoom changes
    zoomDebounceTimeoutRef.current = setTimeout(() => {
      setDebouncedZoom(mapZoom);
    }, 1000); // 1 second debounce

    // Cleanup on unmount or when mapZoom changes
    return () => {
      if (zoomDebounceTimeoutRef.current) {
        clearTimeout(zoomDebounceTimeoutRef.current);
      }
    };
  }, [mapZoom]);

  // Round debounced zoom to nearest 0.5 to reduce visibility update frequency
  // Only update visibility when crossing 0.5, 1.0, 1.5, 2.0, etc. thresholds
  const roundedZoom = useMemo(() => {
    return Math.round(debouncedZoom * 2) / 2; // Round to nearest 0.5
  }, [debouncedZoom]);

  // Helper to compute zoom-based visibility (cheap check, no side effects)
  // Uses roundedZoom (from debouncedZoom) to only update after user stops zooming
  const getZoomVisibility = useCallback(
    (layer: LayerProps): boolean => {
      // Hand-drawn sketches (lines/polygons/points/azimuths) are never AUTO
      // zoom-gated — the store deliberately never stamps a computed minzoom on them
      // (that would hide a small drawing at low zoom, making the visibility toggle
      // look broken). BUT if the user has EXPLICITLY set a Min/Max Zoom in layer
      // settings, honour it: hide the sketch when the map is outside that range.
      // (For sketches, minzoom/maxzoom are only ever present when user-configured.)
      if (isSketchLayer(layer)) {
        if (layer.minzoom === undefined && layer.maxzoom === undefined) {
          return true;
        }
        // Compare the zoom rounded to the SAME 2 decimals the on-screen readout
        // shows — NOT roundedZoom (nearest 0.5, which turns 4.96 into 5.0 and would
        // wrongly show a min-zoom-5 sketch below zoom 5), and NOT the raw float
        // (which is often 6.9997 when the readout says "7.00", so a strict `>= 7`
        // would wrongly HIDE it at its own min zoom). Rounding to 2 dp makes Min
        // Zoom INCLUSIVE at exactly the value the user sees: readout ≥ Min → shown.
        const z = Math.round(debouncedZoom * 100) / 100;
        return (
          z >= (layer.minzoom ?? 0) &&
          z <= (layer.maxzoom ?? DEFAULT_LAYER_MAX_ZOOM)
        );
      }

      let minZoom: number | undefined = layer.minzoom;
      let maxZoom = layer.maxzoom ?? DEFAULT_LAYER_MAX_ZOOM;

      if (minZoom === undefined) {
        const zoomRange = calculateLayerZoomRange(layer);
        if (zoomRange) {
          minZoom = zoomRange.minZoom;
          maxZoom = zoomRange.maxZoom;
        } else {
          return true; // Show if can't calculate
        }
      }

      // Compare against the zoom rounded to the SAME 2 decimals the on-screen
      // readout shows — identical to the sketch branch above, so "Min Zoom 9" means
      // the same thing for an uploaded layer as for a drawn one.
      //
      // This used to be `Math.floor(roundedZoom)`, and `roundedZoom` is the zoom
      // rounded to the nearest 0.5. That rounds UP: at a readout of 8.97,
      // Math.round(8.97*2)/2 = 9.0, floor = 9, and 9 >= 9 passes — so an uploaded
      // layer with Min Zoom 9 stayed visible from 8.75 upward, a quarter of a level
      // before the readout ever reached its minimum. Flooring was chosen for the
      // integer auto-computed ranges, but it silently applied to explicit user
      // values too, which is what made the slider disagree with the readout.
      const z2dp = Math.round(debouncedZoom * 100) / 100;
      return z2dp >= minZoom && z2dp <= maxZoom;
    },
    [debouncedZoom],
  );
  // Keep the ref the once-attached mapbox pick handlers read in sync.
  getZoomVisibilityRef.current = getZoomVisibility;

  // Close tooltip when the hovered layer becomes hidden
  useEffect(() => {
    // NOTE: deliberately NOT gated on `hoverInfo.object`. Raster/DEM picks are
    // synthesised with `object: null` (see handleRasterPick and
    // syntheticDemPickingInfo), so an `!hoverInfo.object` guard here skipped every
    // raster — which is why a raster's tooltip stayed on screen after the layer
    // itself had been zoom-hidden. Those picks still carry `layer.id`, which is all
    // the resolution below needs.
    if (!hoverInfo) {
      return;
    }

    // Check if hovered layer is a UDP layer (by checking layer ID)
    const hoveredLayerId = hoverInfo.layer?.id;
    if (
      hoveredLayerId &&
      (hoveredLayerId.includes("udp-") ||
        hoveredLayerId.includes("network-members") ||
        hoveredLayerId.includes("targets"))
    ) {
      // If UDP layers are hidden, clear the tooltip
      if (!networkLayersVisible) {
        setHoverInfo(undefined);
        return;
      }
    }

    // Find the layer ID from the hover info
    const hoveredObject = hoverInfo.object;
    let layerId: string | undefined;

    if ((hoveredObject as any)?.layerId) {
      layerId = (hoveredObject as any).layerId;
    } else if (isStoreLayerPickObject(hoveredObject)) {
      // Only when the picked item IS a store layer. A GeoJSON feature with a
      // top-level `id` (QGIS/ogr write one) also has `id` + `type`, and used to
      // land here — resolving to no layer, so the branch below concluded the
      // hovered layer was deleted and cleared the tooltip on every hover/tap.
      layerId = (hoveredObject as any).id;
    } else if (hoverInfo.layer?.id) {
      const deckLayerId = hoverInfo.layer.id;
      const matchingLayer = layers.find((l) => l.id === deckLayerId);
      layerId = matchingLayer?.id;
      if (!layerId) {
        const baseId = deckLayerId
          .replace(/-icon-layer$/, "")
          .replace(/-signal-overlay$/, "")
          .replace(/-bitmap$/, "")
          .replace(/-mesh$/, "");
        layerId = layers.find((l) => l.id === baseId)?.id;
      }
    }

    // Check if the hovered layer is now hidden or deleted
    if (layerId) {
      const hoveredLayer = layers.find((l) => l.id === layerId);
      if (!hoveredLayer || hoveredLayer.visible === false) {
        setHoverInfo(undefined);
        return;
      }
      // Close the tooltip when the layer is zoom-hidden, asking the SAME predicate
      // the renderer uses rather than re-deriving the range here.
      //
      // This used to compare `Math.floor(mapZoom)` (the LIVE zoom) against a locally
      // recomputed min/max, while the layer's actual on-screen visibility comes from
      // `getZoomVisibility` (debounced zoom, rounded to 0.5, with sketches exempt
      // unless explicitly configured). The two desynced mid-zoom in both directions:
      // a tooltip could vanish for a feature still being drawn, or — as reported —
      // survive after its layer had gone. Sharing the predicate makes tooltip and
      // layer agree by construction.
      if (!getZoomVisibility(hoveredLayer)) {
        setHoverInfo(undefined);
      }
    }
  }, [
    layers,
    hoverInfo,
    setHoverInfo,
    networkLayersVisible,
    getZoomVisibility,
  ]);

  const deckGlLayers = useMemo(() => {
    const isLayerVisible = (layer: LayerProps) => {
      if (layer.visible === false) return false;
      const name = layer.name || "";
      const isNetworkLayer =
        name.includes("Network") ||
        name.includes("Connection") ||
        layer.type === "nodes";
      if (isNetworkLayer && !networkLayersVisible) {
        return false;
      }
      return true;
    };

    const guardColor = (color: number[] = [0, 0, 0]) =>
      color.length === 4 ? color : [...color, 255];

    // Don't filter by zoom here - we'll use Deck.gl's visible prop instead
    // This prevents layer recreation on zoom changes
    const visibleLayers = layers
      .filter(isLayerVisible)
      .filter(
        (layer) =>
          !(layer.type === "point" && layer.name?.startsWith("Polygon Point")),
      );
    // Sketch types (point / line / polygon / azimuth) are each rendered as ONE
    // combined deck layer holding every layer of that type. That means the zoom
    // gate has to be applied PER LAYER when building the data — not as a single
    // `visible` flag on the combined layer.
    //
    // It used to be `someLayers.some(l => visible && getZoomVisibility(l))`, i.e.
    // "is ANY layer of this type visible?", while the data still contained ALL of
    // them. So with two or more layers of the same type, setting Min Zoom on one
    // did nothing: a sibling kept the combined layer visible and the out-of-range
    // layer carried on drawing. It only appeared to work when you happened to have
    // exactly one layer of that type, which is why it looked erratic.
    //
    // Filtering the source arrays here fixes every combined layer at once, and
    // matches what `point-layer` was already doing correctly.
    const passesZoom = (l: LayerProps) =>
      l.visible !== false && getZoomVisibility(l);

    const pointLayers = visibleLayers.filter((l) => l.type === "point");
    const lineLayers = visibleLayers
      .filter(
        (l) => l.type === "line" && !(l.name || "").includes("Connection"),
      )
      .filter(passesZoom);
    const connectionLayers = visibleLayers
      .filter((l) => l.type === "line" && (l.name || "").includes("Connection"))
      .filter(passesZoom);
    const polygonLayers = visibleLayers
      .filter((l) => l.type === "polygon")
      .filter(passesZoom);
    const azimuthLayers = visibleLayers
      .filter((l) => l.type === "azimuth")
      .filter(passesZoom);
    const geoJsonLayers = visibleLayers.filter((l) => l.type === "geojson");
    const demLayers = visibleLayers.filter((l) => l.type === "dem");
    const annotationLayers = visibleLayers.filter(
      (l) => l.type === "annotation",
    );

    const deckLayers: any[] = [];
    const measurementCharacterSet = [
      "0",
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      ".",
      "-",
      "°",
      "k",
      "m",
      "A",
      "P",
      ":",
      "•",
      "²",
      "h",
      "a",
      " ",
    ];

    // Add raster layers FIRST so they render at the bottom (behind other layers)
    demLayers.forEach((layer) => {
      if (!layer.bounds) return;
      const [minLng, minLat] = layer.bounds[0];
      const [maxLng, maxLat] = layer.bounds[1];

      const isVisible = layer.visible !== false && getZoomVisibility(layer);

      // Tiled rasters: pixels come from a Mapbox raster source added in a
      // separate effect. We push an invisible SolidPolygonLayer over the
      // bounds so deck.gl picking still fires `handleLayerHover` (which
      // resolves to a tile-server sampleAt for the precise value).
      //
      // Why SolidPolygonLayer and not BitmapLayer:
      //   BitmapLayer's fragment shader writes fragColor.a = texAlpha *
      //   layer.opacity, and the picking pass uses that same alpha. With
      //   opacity 0 (or a transparent texture) the picking framebuffer
      //   pixel becomes alpha-0, which deck.gl reads as "no pick" — so
      //   hover events stop firing. SolidPolygonLayer's picking pass
      //   writes its picking color independently of the visible
      //   fillColor's alpha, so a fully transparent fillColor still
      //   picks reliably.
      if (layer.tilesUrl) {
        // Tiled rasters render entirely through Mapbox (raster source +
        // raster layer set up in addOrUpdateTiledRaster). The previous
        // SolidPolygonLayer was a picking proxy with alpha-0 fill — it
        // contributed nothing visually and is no longer picked (we use
        // JS rect-pick in handleRasterPick now). Skipping the push
        // eliminates 153 wasted draw calls per frame at N=153 tiled
        // rasters, which is the dominant deck.gl per-frame cost during
        // pan/zoom.
        //
        // Zoom-range enforcement is unaffected: addOrUpdateTiledRaster
        // calls map.setLayerZoomRange(...) on the Mapbox raster layer
        // using resolveLayerZoomRange(layer), which honours
        // layer.minzoom / layer.maxzoom. Viewport culling
        // (applyTiledRasterViewportCulling) toggles visibility on the
        // same Mapbox layer. Neither path went through the deck.gl
        // SolidPolygonLayer — so removing it changes nothing visible.
        return;
      }

      // Ensure we hand BitmapLayer a canvas (avoid createImageBitmap on blobs)
      const image =
        ensureCanvasImage(layer.bitmap) ||
        ensureCanvasImage(layer.texture) ||
        null;

      if (!image) {
        return;
      }

      deckLayers.push(
        new BitmapLayer({
          id: `${layer.id}-bitmap`,
          image,
          bounds: [minLng, minLat, maxLng, maxLat],
          // pickable: false — non-tiled DEM rasters now picked via the
          // same JS rect-test handler used for tiled rasters
          // (handleRasterPick walks layer.bounds for these). Removes
          // the deck.gl GPU picking pass cost when many BitmapLayer
          // rasters are loaded AND lifts the 255-pickable cap.
          // BitmapLayer's image still renders normally (unlike the
          // tiled SolidPolygonLayer which was an invisible proxy and
          // got removed entirely).
          pickable: false,
          visible: isVisible, // Use Deck.gl's visible prop - handled on GPU
          updateTriggers: {
            visible: [roundedZoom, layer.visible], // Update visibility on zoom (at 0.5 intervals)
          },
        }),
      );
    });

    if (pointLayers.length) {
      // Filter per point so each point's own minzoom/maxzoom is honoured.
      // The previous `some()` made one layer's zoom apply to ALL points
      // (a single ScatterplotLayer with the full pointLayers array as data
      // — if any point passed, every point rendered).
      const visiblePointLayers = pointLayers.filter(
        (l) => l.visible !== false && getZoomVisibility(l),
      );

      // Create a unique key based on all radius values to force update
      const radiusKey = visiblePointLayers
        .map((l) => `${l.id}:${l.radius ?? 5}`)
        .join("|");

      deckLayers.push(
        new ScatterplotLayer({
          id: "point-layer",
          data: visiblePointLayers,
          visible: visiblePointLayers.length > 0,
          getPosition: (d: LayerProps) => d.position!,
          getRadius: (d: LayerProps) => d.radius ?? 5, // Use radius for point layers
          radiusUnits: "pixels", // Use pixels instead of meters
          getFillColor: (d: LayerProps) => {
            const color = d.color ? [...d.color] : [59, 130, 246];
            return (color.length === 3 ? [...color, 255] : color) as [
              number,
              number,
              number,
              number,
            ];
          },
          getLineColor: (d: LayerProps) => {
            const color = d.color ? d.color.slice(0, 3) : [59, 130, 246];
            return color.map((c) => Math.max(0, c - 40)) as [
              number,
              number,
              number,
            ];
          },
          getLineWidth: 1,
          // Pixel units for the stroke. The geodetic (EPSG:4326) OrthographicView
          // has no projection to convert meters against, so a meter-based stroke
          // (deck's default) blows up into a huge pale ring around the point — the
          // "concentric circle" artifact. Pixels render identically on mercator and
          // geodetic.
          lineWidthUnits: "pixels",
          stroked: true,
          pickable: true,
          pickingRadius: 20, // Larger picking radius for touch devices
          // Floor at 3px so a point set to the slider minimum (1px) stays visible
          // and clickable — matches the earlier "perfect" behaviour that 6d2e26c5
          // regressed to 1.
          radiusMinPixels: 3,
          radiusMaxPixels: 50,
          onHover: handleLayerHover,
          updateTriggers: {
            getRadius: [radiusKey], // Update when any radius changes
            getFillColor: [
              visiblePointLayers.map((l) => l.color?.join(",")).join("|"),
            ],
            // Recompute the data array when zoom crosses a 0.5 step, when
            // any layer's per-point minzoom/maxzoom changes, or when
            // visibility toggles.
            data: [
              roundedZoom,
              pointLayers
                .map(
                  (l) =>
                    `${l.id}:${l.visible}:${l.minzoom ?? ""}:${l.maxzoom ?? ""}`,
                )
                .join("|"),
            ],
          },
        }),
      );
    }

    // User location layers will be added at the end to render on top

    if (lineLayers.length) {
      const pathData = lineLayers
        .map((layer) => {
          const path = layer.path ?? [];
          if (path.length < 2) return null; // Need at least 2 points for a line

          // Validate coordinates and filter out invalid points
          const validPath = path.filter((point) => {
            return (
              Array.isArray(point) &&
              point.length >= 2 &&
              typeof point[0] === "number" &&
              typeof point[1] === "number" &&
              !isNaN(point[0]) &&
              !isNaN(point[1])
            );
          }) as [number, number][];

          if (validPath.length < 2) return null;

          return {
            path: validPath,
            color: layer.color ? [...layer.color] : [0, 0, 0], // Black default
            width: layer.lineWidth ?? 5,
            layerId: layer.id,
            layer,
          };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null);

      if (pathData.length > 0) {
        // Compute visibility: at least one layer must be visible AND pass zoom check
        // The array is pre-filtered to zoom-visible layers (see `passesZoom`),
        // so this is now just "is there anything left to draw?".
        const isVisible = lineLayers.length > 0;

        deckLayers.push(
          new PathLayer({
            id: "line-layer",
            data: pathData,
            visible: isVisible, // Use Deck.gl's visible prop - handled on GPU
            getPath: (d: any) => d.path,
            getColor: (d: any) => {
              const color = d.color || [0, 0, 0]; // Black default
              return color.length === 3 ? [...color, 255] : color;
            },
            getWidth: (d: any) => Math.max(3, d.width), // Minimum width of 3
            widthUnits: "pixels", // Use pixels instead of meters
            widthMinPixels: 3, // Minimum width of 3 pixels
            widthMaxPixels: 50, // Maximum width of 50 pixels
            pickable: true,
            pickingRadius: 20, // Larger picking radius for touch devices
            onHover: handleLayerHover,
            updateTriggers: {
              visible: [
                roundedZoom,
                lineLayers.map((l) => `${l.id}:${l.visible}`).join("|"),
              ], // Update visibility on zoom
            },
          }),
        );
      }
    }

    if (connectionLayers.length) {
      const connectionPathData = connectionLayers.flatMap((layer) => {
        const path = layer.path ?? [];
        if (path.length < 2) return [];

        return path
          .slice(0, -1)
          .map((point, index) => {
            const nextPoint = path[index + 1];
            // Validate coordinates are valid numbers
            if (
              !Array.isArray(point) ||
              point.length < 2 ||
              !Array.isArray(nextPoint) ||
              nextPoint.length < 2 ||
              typeof point[0] !== "number" ||
              typeof point[1] !== "number" ||
              typeof nextPoint[0] !== "number" ||
              typeof nextPoint[1] !== "number" ||
              isNaN(point[0]) ||
              isNaN(point[1]) ||
              isNaN(nextPoint[0]) ||
              isNaN(nextPoint[1])
            ) {
              return null;
            }
            return {
              sourcePosition: point,
              targetPosition: nextPoint,
              color: layer.color ? [...layer.color] : [128, 128, 128], // Create a copy of the color array
              width: layer.lineWidth ?? 5,
            };
          })
          .filter((item): item is NonNullable<typeof item> => item !== null);
      });

      if (connectionPathData.length > 0) {
        // Compute visibility: at least one layer must be visible AND pass zoom check
        // The array is pre-filtered to zoom-visible layers (see `passesZoom`),
        // so this is now just "is there anything left to draw?".
        const isVisible = connectionLayers.length > 0;

        deckLayers.push(
          new LineLayer({
            id: "connection-line-layer",
            data: connectionPathData,
            visible: isVisible, // Use Deck.gl's visible prop - handled on GPU
            getSourcePosition: (d: any) => d.sourcePosition,
            getTargetPosition: (d: any) => d.targetPosition,
            getColor: (d: any) => d.color,
            getWidth: (d: any) => Math.max(3, d.width), // Minimum width of 3
            widthUnits: "pixels", // Use pixels instead of meters
            widthMinPixels: 3, // Minimum width of 3 pixels
            widthMaxPixels: 50, // Maximum width of 50 pixels
            pickable: true,
            pickingRadius: 20, // Larger picking radius for touch devices
            onHover: handleLayerHover,
            updateTriggers: {
              visible: [
                roundedZoom,
                connectionLayers.map((l) => `${l.id}:${l.visible}`).join("|"),
              ], // Update visibility on zoom (at 0.5 intervals)
            },
          }),
        );
      }
    }

    if (polygonLayers.length) {
      const polygonData = polygonLayers.flatMap((layer) => {
        const rings = getUnkinkedRings(layer.polygon);
        const areaMeters = computePolygonAreaMeters(layer.polygon);
        const perimeterMeters = computePolygonPerimeterMeters(layer.polygon);
        const vertexCount = (() => {
          const outer = layer.polygon?.[0] ?? [];
          const closed =
            outer.length > 1 &&
            outer[0] &&
            outer[outer.length - 1] &&
            Math.abs(outer[0][0] - outer[outer.length - 1][0]) < 1e-10 &&
            Math.abs(outer[0][1] - outer[outer.length - 1][1]) < 1e-10;
          return Math.max(0, outer.length - (closed ? 1 : 0));
        })();
        return rings.map((ring) => ({
          layer,
          ring,
          areaMeters,
          perimeterMeters,
          vertexCount,
        }));
      });

      // Compute visibility: at least one layer must be visible AND pass zoom check
      // The array is pre-filtered to zoom-visible layers (see `passesZoom`),
      // so this is now just "is there anything left to draw?".
      const isVisible = polygonLayers.length > 0;

      deckLayers.push(
        new PolygonLayer({
          id: "polygon-layer",
          data: polygonData,
          visible: isVisible, // Use Deck.gl's visible prop - handled on GPU
          fp64: true, // Use 64-bit precision for Samsung devices
          parameters: { depthTest: false },
          getPolygon: (d: any) => d.ring,
          getFillColor: (d: any) => {
            const color = d.layer.color ?? [32, 32, 32, 120];
            const rgba =
              color.length === 4 ? [...color] : [...color.slice(0, 3), 120];
            return rgba as [number, number, number, number];
          },
          getLineColor: (d: any) =>
            d.layer.color
              ? ([...d.layer.color.slice(0, 3)] as [number, number, number])
              : [32, 32, 32],
          getLineWidth: 1,
          stroked: false,
          pickable: true,
          pickingRadius: 20, // Larger picking radius for touch devices
          onHover: handleLayerHover,
          updateTriggers: {
            visible: [
              roundedZoom,
              polygonLayers.map((l) => `${l.id}:${l.visible}`).join("|"),
            ], // Update visibility on zoom (at 0.5 intervals)
          },
        }),
      );

      const polygonOutlines = polygonData.map((item) => ({
        path: item.ring,
        color: item.layer.color
          ? ([...item.layer.color.slice(0, 3)] as [number, number, number])
          : [32, 32, 32],
        width: item.layer.lineWidth ?? 2,
      }));

      if (polygonOutlines.length) {
        // Use same visibility as polygon layer
        // The array is pre-filtered to zoom-visible layers (see `passesZoom`),
        // so this is now just "is there anything left to draw?".
        const isVisible = polygonLayers.length > 0;

        deckLayers.push(
          new PathLayer({
            id: "polygon-outline-layer",
            data: polygonOutlines,
            visible: isVisible, // Use Deck.gl's visible prop - handled on GPU
            getPath: (d: any) => d.path,
            getColor: (d: any) => d.color,
            getWidth: (d: any) => d.width,
            widthUnits: "pixels",
            widthMinPixels: 3,
            widthMaxPixels: 50,
            parameters: { depthTest: false, depthMask: false },
            pickable: true,
            pickingRadius: 20,
            onHover: handleLayerHover,
            updateTriggers: {
              visible: [
                roundedZoom,
                polygonLayers.map((l) => `${l.id}:${l.visible}`).join("|"),
              ], // Update visibility on zoom (at 0.5 intervals)
            },
          }),
        );
      }

      // Polygon labels now shown only in side panel while drawing.
      // No on-map labels for finalized polygons per latest request.
    }

    // Line layer with vertex rendering (duplicate id but different purpose - needs to be merged or renamed)
    if (lineLayers.length) {
      const pathData = lineLayers.flatMap((layer) => {
        const path = layer.path ?? [];
        if (path.length < 2) return [];

        return path
          .slice(0, -1)
          .map((point, index) => {
            const nextPoint = path[index + 1];
            // Validate coordinates are valid numbers
            if (
              !Array.isArray(point) ||
              point.length < 2 ||
              !Array.isArray(nextPoint) ||
              nextPoint.length < 2 ||
              typeof point[0] !== "number" ||
              typeof point[1] !== "number" ||
              typeof nextPoint[0] !== "number" ||
              typeof nextPoint[1] !== "number" ||
              isNaN(point[0]) ||
              isNaN(point[1]) ||
              isNaN(nextPoint[0]) ||
              isNaN(nextPoint[1])
            ) {
              return null;
            }
            return {
              sourcePosition: point,
              targetPosition: nextPoint,
              color: layer.color ? [...layer.color] : [0, 0, 0],
              width: layer.lineWidth ?? 5,
              layerId: layer.id,
              layerName: layer.name,
              segmentIndex: index,
            };
          })
          .filter((item): item is NonNullable<typeof item> => item !== null);
      });

      if (pathData.length > 0) {
        // Compute visibility: at least one layer must be visible AND pass zoom check
        // The array is pre-filtered to zoom-visible layers (see `passesZoom`),
        // so this is now just "is there anything left to draw?".
        const isVisible = lineLayers.length > 0;

        deckLayers.push(
          new LineLayer({
            id: "line-layer-vertices",
            data: pathData,
            visible: isVisible, // Use Deck.gl's visible prop - handled on GPU
            getSourcePosition: (d: any) => d.sourcePosition,
            getTargetPosition: (d: any) => d.targetPosition,
            getColor: (d: any) => {
              const color = d.color || [0, 0, 0];
              return color.length === 3 ? [...color, 255] : color;
            },
            getWidth: (d: any) => Math.max(3, d.width),
            widthUnits: "pixels",
            widthMinPixels: 3,
            widthMaxPixels: 50,
            pickable: true,
            pickingRadius: 20,
            onHover: handleLayerHover,
            capRounded: true,
            jointRounded: true,
            parameters: { depthTest: false },
            updateTriggers: {
              visible: [
                roundedZoom,
                lineLayers.map((l) => `${l.id}:${l.visible}`).join("|"),
              ], // Update visibility on zoom (at 0.5 intervals)
            },
          }),
        );

        const vertexData = lineLayers.flatMap((layer) => {
          const path = layer.path ?? [];
          if (!path.length) return [];
          return path
            .map((point, index) => {
              // Validate coordinates
              if (
                !Array.isArray(point) ||
                point.length < 2 ||
                typeof point[0] !== "number" ||
                typeof point[1] !== "number" ||
                isNaN(point[0]) ||
                isNaN(point[1])
              ) {
                return null;
              }
              return {
                position: point,
                color: index === 0 ? [255, 213, 79, 255] : [236, 72, 153, 255],
                radius: index === 0 ? 8 : 6, // Fixed-pixel handles (start vertex slightly larger)
              };
            })
            .filter((item): item is NonNullable<typeof item> => item !== null);
        });

        if (vertexData.length > 0) {
          // Use same visibility as line layer
          // The array is pre-filtered to zoom-visible layers (see `passesZoom`),
          // so this is now just "is there anything left to draw?".
          const isVisible = lineLayers.length > 0;

          deckLayers.push(
            new ScatterplotLayer({
              id: "line-vertex-layer",
              data: vertexData,
              visible: isVisible, // Use Deck.gl's visible prop - handled on GPU
              getPosition: (d: any) => d.position,
              getRadius: (d: any) => d.radius,
              // Size vertex handles in PIXELS, not meters. The geodetic (EPSG:4326)
              // base map renders through a cartesian OrthographicView where deck.gl
              // has no projection to convert meters against, so meter-based radius
              // and — worse — the meter-based stroke below blow up into huge pale
              // rings. Pixel units render identically on both mapbox (mercator) and
              // the geodetic view.
              radiusUnits: "pixels",
              getFillColor: (d: any) => d.color,
              getLineColor: [255, 255, 255, 200],
              getLineWidth: 2,
              lineWidthUnits: "pixels",
              stroked: true,
              pickable: false,
              radiusMinPixels: 4,
              radiusMaxPixels: 10,
              parameters: { depthTest: false },
              updateTriggers: {
                visible: [
                  roundedZoom,
                  lineLayers.map((l) => `${l.id}:${l.visible}`).join("|"),
                ], // Update visibility on zoom (at 0.5 intervals)
              },
            }),
          );
        }
      }
    }

    if (azimuthLayers.length) {
      const azimuthLineData = azimuthLayers.flatMap((layer) => {
        const segments: any[] = [];
        const center = layer.azimuthCenter;
        if (center && layer.azimuthNorth) {
          segments.push({
            sourcePosition: center,
            targetPosition: layer.azimuthNorth,
            color: [148, 163, 184, 220],
            width: 2,
            dashArray: [6, 4],
            layerId: layer.id,
            segmentType: "north",
          });
        }
        if (center && layer.azimuthTarget) {
          const baseColor = layer.color
            ? layer.color.length === 4
              ? [...layer.color]
              : [...layer.color, 255]
            : [59, 130, 246, 255];
          segments.push({
            sourcePosition: center,
            targetPosition: layer.azimuthTarget,
            color: baseColor,
            width: layer.lineWidth ?? 6,
            layerId: layer.id,
            segmentType: "target",
          });
        }
        return segments;
      });

      const azimuthLabelData = azimuthLayers
        .map((layer) => {
          if (
            !layer.azimuthCenter ||
            !layer.azimuthTarget ||
            typeof layer.azimuthAngleDeg !== "number"
          ) {
            return null;
          }
          const [cLng, cLat] = layer.azimuthCenter;
          const [tLng, tLat] = layer.azimuthTarget;
          const labelLng = cLng + (tLng - cLng) * 0.4;
          const labelLat = cLat + (tLat - cLat) * 0.4;
          let signedAngle = normalizeAngleSigned(layer.azimuthAngleDeg);
          if (signedAngle === -180) signedAngle = 180;
          return {
            position: [labelLng, labelLat] as [number, number],
            text: `${signedAngle.toFixed(1)}°`,
            // Carry the layer id so tapping the angle LABEL (not just the line)
            // still resolves the layer name in the tooltip.
            layerId: layer.id,
          };
        })
        .filter(Boolean);

      // Compute visibility: at least one layer must be visible AND pass zoom check
      // The array is pre-filtered to zoom-visible layers (see `passesZoom`),
      // so this is now just "is there anything left to draw?".
      const isAzimuthVisible = azimuthLayers.length > 0;

      if (azimuthLineData.length) {
        deckLayers.push(
          new LineLayer({
            id: "azimuth-lines-layer",
            data: azimuthLineData,
            visible: isAzimuthVisible, // Use Deck.gl's visible prop - handled on GPU
            pickable: true,
            pickingRadius: 20,
            onHover: handleLayerHover,
            getSourcePosition: (d: any) => d.sourcePosition,
            getTargetPosition: (d: any) => d.targetPosition,
            getColor: (d: any) => d.color,
            getWidth: (d: any) => d.width,
            getDashArray: (d: any) => d.dashArray ?? [0, 0],
            dashJustified: true,
            updateTriggers: {
              visible: [
                roundedZoom,
                azimuthLayers.map((l) => `${l.id}:${l.visible}`).join("|"),
              ], // Update visibility on zoom (at 0.5 intervals)
            },
          }),
        );
      }

      if (azimuthLabelData.length) {
        deckLayers.push(
          new TextLayer({
            id: "azimuth-angle-labels",
            data: azimuthLabelData as Array<{
              position: [number, number];
              text: string;
            }>,
            visible: isAzimuthVisible, // Use Deck.gl's visible prop - handled on GPU
            pickable: false,
            getPosition: (d) => d.position,
            getText: (d) => d.text,
            getSize: 14,
            getColor: [59, 130, 246, 255],
            getTextAnchor: "middle",
            getAlignmentBaseline: "center",
            fontWeight: 600,
            background: true,
            getBackgroundColor: [255, 255, 255, 200],
            padding: [2, 4],
            characterSet: measurementCharacterSet,
            updateTriggers: {
              visible: [
                roundedZoom,
                azimuthLayers.map((l) => `${l.id}:${l.visible}`).join("|"),
              ], // Update visibility on zoom (at 0.5 intervals)
            },
          }),
        );
      }
    }

    geoJsonLayers.forEach((layer) => {
      if (!layer.geojson) return;
      const lineWidth = layer.lineWidth ?? 5;
      const isVisible = layer.visible !== false && getZoomVisibility(layer);

      deckLayers.push(
        new GeoJsonLayer({
          id: layer.id,
          data: layer.geojson,
          visible: isVisible, // Use Deck.gl's visible prop - handled on GPU
          fp64: true, // Use 64-bit precision for Samsung devices
          parameters: { depthTest: false },
          pickable: true,
          pickingRadius: 20, // Larger picking radius for touch devices
          stroked: true,
          filled: true,
          pointRadiusUnits: "pixels", // Use pixels for point radius
          lineWidthUnits: "pixels", // Use pixels for line width
          // Floor at 3px so an uploaded layer set to the slider minimum (1px) stays
          // visible and clickable (same minimum as drawn points/lines).
          pointRadiusMinPixels: 3,
          pointRadiusMaxPixels: 50,
          lineWidthMinPixels: 3,
          lineWidthMaxPixels: 50,
          getFillColor: (f: any) =>
            f.properties?.color ?? [...(layer.color ?? [0, 150, 255]), 120],
          getLineColor: (f: any) =>
            // Shortest-route features bake an amber `properties.lineColor` at
            // creation, which would otherwise always win and make the Settings
            // color picker do nothing. Detect the route by its baked
            // `properties.shortestRoute` flag (survives a rename) and honour the
            // store `layer.color` (what the picker updates) instead of the baked value.
            f.properties?.shortestRoute
              ? guardColor(layer.color ?? [0, 150, 255])
              : (f.properties?.lineColor ??
                guardColor(layer.color ?? [0, 150, 255])),
          getPointRadius: (f: any) =>
            f.geometry?.type === "Point" ? (layer.pointRadius ?? 5) : 0,
          getLineWidth: (f: any) => {
            const type = f.geometry?.type;
            // GeometryCollection features (e.g. highway networks) carry their lines
            // inside `geometries`, so the feature's own type is "GeometryCollection"
            // — include it or the slider can't change their width (drew at 2 always).
            if (
              type === "LineString" ||
              type === "MultiLineString" ||
              type === "GeometryCollection"
            ) {
              return lineWidth;
            }
            return 2;
          },
          updateTriggers: {
            getFillColor: [layer.color],
            getLineColor: [layer.color],
            getPointRadius: [layer.pointRadius],
            getLineWidth: [layer.lineWidth],
            visible: [roundedZoom, layer.visible], // Update visibility on zoom (at 0.5 intervals)
          },
          onHover: handleLayerHover,
        }),
      );
    });

    annotationLayers.forEach((layer) => {
      if (!layer.annotations?.length) return;
      const isVisible = layer.visible !== false && getZoomVisibility(layer);

      deckLayers.push(
        new TextLayer({
          id: layer.id,
          data: layer.annotations,
          visible: isVisible, // Use Deck.gl's visible prop - handled on GPU
          getPosition: (d: any) => d.position,
          getText: (d: any) => d.text,
          getColor: (d: any) => d.color ?? layer.color ?? [0, 0, 0],
          getSize: (d: any) => d.fontSize ?? 14,
          getAngle: 0,
          getTextAnchor: "middle",
          getAlignmentBaseline: "center",
          pickable: true,
          pickingRadius: 20, // Larger picking radius for touch devices
          sizeScale: 1,
          fontFamily: "Arial, sans-serif",
          fontWeight: "normal",
          onHover: handleLayerHover,
          updateTriggers: {
            visible: [roundedZoom, layer.visible], // Update visibility on zoom (at 0.5 intervals)
          },
        }),
      );
    });

    // --- Preview layers ---
    const previewLayers: any[] = [];

    // Add UDP layers to the deck layers only when networkLayersVisible is true
    if (networkLayersVisible && udpLayers && udpLayers.length > 0) {
      deckLayers.push(...udpLayers);
    }
    if (
      isDrawing &&
      drawingMode === "polygon" &&
      currentPath.length >= 1 &&
      mousePosition
    ) {
      if (currentPath.length === 1) {
        const previewLineData = [
          {
            sourcePosition: currentPath[0],
            targetPosition: mousePosition,
            color: [160, 160, 160],
            width: 2,
          },
        ];
        previewLayers.push(
          new LineLayer({
            id: "preview-polygon-edge",
            data: previewLineData,
            getSourcePosition: (d: any) => d.sourcePosition,
            getTargetPosition: (d: any) => d.targetPosition,
            getColor: (d: any) => d.color,
            getWidth: (d: any) => d.width,
            pickable: false,
          }),
        );
      } else {
        const previewPath = closeRing([...currentPath, mousePosition]);
        previewLayers.push(
          new PolygonLayer({
            id: "preview-polygon-layer",
            fp64: true, // Use 64-bit precision for Samsung devices
            data: [previewPath],
            parameters: { depthTest: false },
            getPolygon: (d: [number, number][]) => d,
            getFillColor: [32, 32, 32, 60],
            getLineColor: [32, 32, 32],
            getLineWidth: 1,
            stroked: false,
            pickable: false,
          }),
        );
        previewLayers.push(
          new PathLayer({
            id: "preview-polygon-outline-layer",
            data: [previewPath],
            getPath: (d: [number, number][]) => d,
            getColor: [32, 32, 32],
            getWidth: 2,
            widthUnits: "pixels",
            widthMinPixels: 3,
            parameters: { depthTest: false, depthMask: false },
            pickable: false,
          }),
        );

        if (
          isPointNearFirstPoint(mousePosition, currentPath[0]) &&
          previewPath.length >= 3
        ) {
          const closingLineData = [
            {
              sourcePosition: mousePosition,
              targetPosition: currentPath[0],
              color: [255, 255, 0],
              width: 3,
            },
          ];
          previewLayers.push(
            new LineLayer({
              id: "preview-polygon-closing",
              data: closingLineData,
              getSourcePosition: (d: any) => d.sourcePosition,
              getTargetPosition: (d: any) => d.targetPosition,
              getColor: (d: any) => d.color,
              getWidth: (d: any) => d.width,
              pickable: false,
            }),
          );
        }
      }
    }

    if (isDrawing && drawingMode === "polyline" && currentPath.length >= 1) {
      const segments =
        currentPath.length > 1
          ? currentPath.slice(0, -1).map((point, index) => ({
              sourcePosition: point,
              targetPosition: currentPath[index + 1],
              color: [96, 96, 96],
              width: 3,
            }))
          : [];

      if (segments.length) {
        previewLayers.push(
          new LineLayer({
            id: "preview-polyline-existing",
            data: segments,
            getSourcePosition: (d: any) => d.sourcePosition,
            getTargetPosition: (d: any) => d.targetPosition,
            getColor: (d: any) => d.color,
            getWidth: (d: any) => d.width,
            pickable: false,
          }),
        );
      }

      if (mousePosition) {
        const lastPoint = currentPath[currentPath.length - 1];
        previewLayers.push(
          new LineLayer({
            id: "preview-polyline-next",
            data: [
              {
                sourcePosition: lastPoint,
                targetPosition: mousePosition,
                color: [96, 96, 96],
                width: 3,
              },
            ],
            getSourcePosition: (d: any) => d.sourcePosition,
            getTargetPosition: (d: any) => d.targetPosition,
            getColor: (d: any) => d.color,
            getWidth: (d: any) => d.width,
            pickable: false,
          }),
        );
      }
    }

    if (
      isDrawing &&
      drawingMode === "azimuthal" &&
      currentPath.length === 1 &&
      mousePosition
    ) {
      const center = currentPath[0];
      const distanceMeters = calculateDistanceMeters(center, mousePosition);
      const referenceDistance = Math.max(distanceMeters, 1000);
      const northPoint = destinationPoint(center, referenceDistance, 0);
      const angleDeg = calculateBearingDegrees(center, mousePosition);
      const labelLng = center[0] + (mousePosition[0] - center[0]) * 0.4;
      const labelLat = center[1] + (mousePosition[1] - center[1]) * 0.4;
      const previewAzimuthData = [
        {
          sourcePosition: center,
          targetPosition: northPoint,
          color: [148, 163, 184],
          width: 2,
          dashArray: [6, 4],
        },
        {
          sourcePosition: center,
          targetPosition: mousePosition,
          color: [59, 130, 246],
          width: 6,
        },
      ];
      previewLayers.push(
        new LineLayer({
          id: "preview-azimuth-lines",
          data: previewAzimuthData,
          getSourcePosition: (d: any) => d.sourcePosition,
          getTargetPosition: (d: any) => d.targetPosition,
          getColor: (d: any) => d.color,
          getWidth: (d: any) => d.width,
          getDashArray: (d: any) => d.dashArray ?? [0, 0],
          dashJustified: true,
          pickable: false,
        }),
      );
      if (distanceMeters > 5) {
        let signedPreviewAngle = normalizeAngleSigned(angleDeg);
        if (signedPreviewAngle === -180) signedPreviewAngle = 180;
        previewLayers.push(
          new TextLayer({
            id: "preview-azimuth-angle-label",
            data: [
              {
                position: [labelLng, labelLat] as [number, number],
                text: `${signedPreviewAngle.toFixed(1)}°`,
              },
            ],
            pickable: false,
            getPosition: (d: any) => d.position,
            getText: (d: any) => d.text,
            getSize: 14,
            getColor: [59, 130, 246, 255],
            getTextAnchor: "middle",
            getAlignmentBaseline: "center",
            fontWeight: 600,
            background: true,
            getBackgroundColor: [255, 255, 255, 220],
            padding: [2, 4],
            characterSet: measurementCharacterSet,
          }),
        );
      }
    }

    if (isDrawing && currentPath.length > 0) {
      const previewPointData = currentPath.map((point, index) => ({
        position: point,
        radius: index === 0 ? 6 : 5, // pixels — see radiusUnits note below
        color: index === 0 ? [255, 255, 0] : [255, 0, 255],
      }));
      previewLayers.push(
        new ScatterplotLayer({
          id: "preview-point-layer",
          data: previewPointData,
          getPosition: (d: any) => d.position,
          getRadius: (d: any) => d.radius,
          // Pixels, NOT meters: on the geodetic OrthographicView world units are
          // degrees, so a "meters" radius blows up and pins to radiusMaxPixels
          // (~10px) — the oversized dots. Mapbox meanwhile pinned to the 4px min,
          // so the two views disagreed. Fixed pixels keeps a small, identical dot
          // on every projection, matching the pbf/mercator feel.
          radiusUnits: "pixels",
          getFillColor: (d: any) => d.color,
          pickable: false,
          radiusMinPixels: 3,
          radiusMaxPixels: 8,
        }),
      );
    }

    // ── Route finder layers ─────────────────────────────────────────────────
    const routeLayers: any[] = [];
    if (isRoutePanelOpen) {
      const routeSelectedLayer = routeState.selectedLayerId
        ? layers.find((l) => l.id === routeState.selectedLayerId)
        : null;
      const routeLayerVisible =
        !routeSelectedLayer ||
        (routeSelectedLayer.visible !== false &&
          getZoomVisibility(routeSelectedLayer));
      const markerData: {
        position: [number, number];
        color: [number, number, number];
        label: string;
      }[] = [];
      if (routeState.snappedA) {
        markerData.push({
          position: routeState.snappedA,
          color: [34, 197, 94],
          label: "A",
        });
      }
      if (routeState.snappedB) {
        markerData.push({
          position: routeState.snappedB,
          color: [239, 68, 68],
          label: "B",
        });
      }
      if (markerData.length > 0 && routeLayerVisible) {
        routeLayers.push(
          new ScatterplotLayer({
            id: "route-markers-outer",
            data: markerData,
            getPosition: (d: any) => d.position,
            getRadius: 14,
            radiusUnits: "pixels",
            getFillColor: (d: any) =>
              [d.color[0], d.color[1], d.color[2], 50] as [
                number,
                number,
                number,
                number,
              ],
            pickable: false,
          }),
        );
        routeLayers.push(
          new ScatterplotLayer({
            id: "route-markers-inner",
            data: markerData,
            getPosition: (d: any) => d.position,
            getRadius: 8,
            radiusUnits: "pixels",
            getFillColor: (d: any) => d.color,
            pickable: false,
          }),
        );
        routeLayers.push(
          new TextLayer({
            id: "route-markers-labels",
            data: markerData,
            getPosition: (d: any) => d.position,
            getText: (d: any) => d.label,
            getSize: 12,
            getColor: [255, 255, 255, 255],
            getTextAnchor: "middle",
            getAlignmentBaseline: "center",
            fontWeight: 700,
            pickable: false,
          }),
        );
      }
    }

    // Return layers (user location will be added separately after default layers)
    return [...deckLayers, ...previewLayers, ...routeLayers];
  }, [
    layers,
    networkLayersVisible,
    isDrawing,
    drawingMode,
    currentPath,
    mousePosition,
    handleLayerHover,
    udpLayers,
    getUnkinkedRings,
    closeRing,
    roundedZoom, // Use roundedZoom (0.5 intervals) to reduce update frequency
    getZoomVisibility, // Include zoom visibility helper
    isRoutePanelOpen,
    routeState.pathResult,
    routeState.snappedA,
    routeState.snappedB,
    routeState.selectedLayerId,
  ]);

  // The user-location marker for the geodetic view. The mapbox overlay builds its
  // own (below), but deckGlLayers deliberately excludes it — so the OrthographicView
  // never got the "Your location" pin. The IconLayer is pixel-sized, so it renders
  // identically here. (The mapbox accuracy ring uses radiusUnits:"meters", which is
  // meaningless on the non-geospatial ortho view, so it is omitted here.)
  const geodeticUserLocationLayers = useMemo(() => {
    if (!userLocation || !showUserLocation) return [];
    return [
      new IconLayer({
        id: "user-location-layer",
        data: [{ position: [userLocation.lng, userLocation.lat] }],
        getIcon: () => ({
          url: USER_LOCATION_ICON_URL,
          width: 24,
          height: 24,
          anchorY: 24,
        }),
        getPosition: (d: any) => d.position,
        sizeScale: 1,
        sizeMinPixels: 24,
        sizeMaxPixels: 48,
        pickable: true,
        pickingRadius: 20,
        onHover: handleLayerHover,
      }),
    ];
  }, [userLocation, showUserLocation, handleLayerHover]);

  const geodeticLayers = useMemo(
    () => [...deckGlLayers, ...geodeticUserLocationLayers],
    [deckGlLayers, geodeticUserLocationLayers],
  );

  return (
    <div
      className={`relative h-screen w-screen overflow-hidden ${
        isMapEnabled ? "bg-transparent" : "bg-black"
      }`}
    >
      <OfflineLocationTracker />
      {selectedNodeForIcon && (
        <IconSelection
          selectedNodeForIcon={selectedNodeForIcon}
          setSelectedNodeForIcon={setSelectedNodeForIcon}
        />
      )}

      {measurementPreview && (
        <div
          className="absolute right-2 z-40 w-64 rounded-lg border border-black/10 bg-white shadow-xl p-3 space-y-2"
          style={{ top: 54 }}
        >
          <div className="flex items-center justify-between text-xs font-semibold text-gray-500 uppercase tracking-wide">
            <span>Drawing Measurements</span>
          </div>
          {measurementPreview.type === "polygon" ? (
            <div className="space-y-1 text-sm text-gray-700">
              <div className="flex justify-between">
                <span>Area</span>
                <span className="font-mono">
                  {formatArea(measurementPreview.areaMeters)}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Perimeter</span>
                <span className="font-mono">
                  {formatDistance(measurementPreview.perimeterMeters / 1000)}
                </span>
              </div>
            </div>
          ) : (
            <>
              {measurementPreview.segments.length > 0 && (
                <>
                  <div className="text-xs text-gray-500">Segments</div>
                  <div className="measurement-scrollbar space-y-1 max-h-38 overflow-y-auto pr-1 text-sm text-gray-700">
                    {measurementPreview.segments.map((segment, idx) => (
                      <div
                        key={`${segment.label}-${idx}`}
                        className="flex justify-between"
                      >
                        <span>{segment.label}</span>
                        <span className="font-mono">
                          {segment.lengthKm.toFixed(2)} km
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
              {polylinePreviewStats && (
                <div className="mt-2 space-y-1 border-t border-dashed border-slate-200 pt-2 text-xs text-gray-700">
                  <div className="flex justify-between">
                    <span>Count</span>
                    <span className="font-mono">
                      {polylinePreviewStats.count}
                    </span>
                  </div>
                  {polylinePreviewStats.count > 1 && (
                    <>
                      <div className="flex justify-between">
                        <span>Max segment</span>
                        <span className="font-mono">
                          {polylinePreviewStats.max.toFixed(2)} km
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>Min segment</span>
                        <span className="font-mono">
                          {polylinePreviewStats.min.toFixed(2)} km
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>Avg segment</span>
                        <span className="font-mono">
                          {polylinePreviewStats.avg.toFixed(2)} km
                        </span>
                      </div>
                    </>
                  )}
                </div>
              )}
              <div className="text-xs font-semibold text-gray-800">
                Total: {measurementPreview.totalKm.toFixed(2)} km
              </div>
            </>
          )}
        </div>
      )}

      {/* UDP Connection Error Banner */}
      {networkLayersVisible && connectionError && showConnectionError && (
        <div className="absolute bottom-14 right-78 z-50 bg-white rounded-lg shadow-lg p-3 max-w-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <div className="font-semibold mb-1.5 text-sm text-red-600">
                Connection Error
              </div>
              <div className="text-xs space-y-1 text-gray-700">
                <div>Failed to connect to UDP server</div>
                <div className="text-gray-600">Port: {UDP_PORT} (fixed)</div>
                <div className="text-gray-500 text-[10px] mt-1">
                  {connectionError.includes("Error:")
                    ? connectionError.split("Error:")[1]?.trim()
                    : "Please check network connectivity"}
                </div>
              </div>
            </div>
            <button
              onClick={() => setShowConnectionError(false)}
              className="text-gray-400 hover:text-gray-600 transition-colors shrink-0"
              title="Close"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* UDP No Data Warning Banner */}
      {networkLayersVisible && noDataWarning && showConnectionError && (
        <div className="absolute bottom-32 right-4 z-50 bg-white rounded-lg shadow-lg p-3 max-w-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1">
              <div className="font-semibold mb-1.5 text-sm text-orange-600">
                No Data Warning
              </div>
              <div className="text-xs space-y-1 text-gray-700">
                <div>{noDataWarning}</div>
                <div className="text-gray-600">Port: {UDP_PORT} (fixed)</div>
              </div>
            </div>
            <button
              onClick={() => setShowConnectionError(false)}
              className="text-gray-400 hover:text-gray-600 transition-colors shrink-0"
              title="Close"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>
      )}

      {isMeasurementBoxOpen && (
        <MeasurementBox onClose={() => setIsMeasurementBoxOpen(false)} />
      )}

      {isNetworkBoxOpen && (
        <NetworkBox onClose={() => setIsNetworkBoxOpen(false)} />
      )}

      {isRoutePanelOpen && (
        <RouteBox
          onClose={closeRoutePanel}
          routeState={routeState}
          setRouteState={setRouteState}
          workerRef={dijkstraWorkerRef}
          mapZoom={mapZoom}
        />
      )}

      <Map
        ref={mapRef}
        style={{ width: "100%", height: "100%" }}
        mapboxAccessToken={MAPBOX_ACCESS_TOKEN}
        mapStyle={undefined}
        // Don't use mapStyle prop - we load style manually after modifying tile URLs
        renderWorldCopies={false}
        reuseMaps={true}
        attributionControl={false}
        dragRotate={true}
        pitchWithRotate={true}
        initialViewState={{
          longitude: DEFAULT_CENTER[0],
          latitude: DEFAULT_CENTER[1],
          zoom: DEFAULT_ZOOM,
          pitch: pitch,
          bearing: 0,
        }}
        minZoom={MAP_MIN_ZOOM}
        maxZoom={MAP_MAX_ZOOM}
        maxPitch={MAP_MAX_PITCH}
        onLoad={async (map: any) => {
          const mapInstance = map.target;

          // Remove any old raster tile sources/layers if they exist (we only use tile server)
          try {
            if (mapInstance.getLayer("offline-tiles-layer")) {
              mapInstance.removeLayer("offline-tiles-layer");
            }
            if (mapInstance.getSource("offline-tiles")) {
              mapInstance.removeSource("offline-tiles");
            }
          } catch (e) {
            // Ignore errors if source/layer doesn't exist
          }

          // Get tile server URL directly (don't rely on state which might not be set yet)
          const { initializeTileServer } = await import("./tile-folder-dialog");
          let serverUrl = tileServerUrl || (await initializeTileServer());

          // Ensure serverUrl doesn't have trailing slash
          if (serverUrl && serverUrl.endsWith("/")) {
            serverUrl = serverUrl.slice(0, -1);
          }

          // Always load style manually (never use mapStyle prop to ensure we can modify URLs)
          if (serverUrl) {
            // Update state if needed
            if (serverUrl !== tileServerUrl) {
              setTileServerUrl(serverUrl);
            }

            // Load style from tile server
            const styleUrl = `${serverUrl}/style.json`;

            try {
              // Fetch style.json to modify it
              const response = await fetch(styleUrl);

              if (!response.ok) {
                throw new Error(
                  `Failed to fetch style.json: ${response.status}`,
                );
              }

              let styleJson = await response.json();

              // Force ALL tile URLs to point to tile server
              if (styleJson.sources) {
                Object.keys(styleJson.sources).forEach((sourceKey) => {
                  const source = styleJson.sources[sourceKey];
                  if (source.type === "vector" && source.tiles) {
                    source.tiles = source.tiles.map((tileUrl: string) => {
                      // Extract the tile path (e.g., /3/5/3.pbf from any URL format)
                      let tilePath = tileUrl;

                      // If it's an absolute URL, extract the path
                      try {
                        const url = new URL(tilePath);
                        tilePath = url.pathname;
                      } catch {
                        // Not a valid URL, might be relative or template
                      }

                      // Handle Mapbox tile URL templates like {z}/{x}/{y}.pbf
                      // If it's a template, keep it but ensure it points to our server
                      if (
                        tilePath.includes("{z}") ||
                        tilePath.includes("{x}") ||
                        tilePath.includes("{y}")
                      ) {
                        // Template format - ensure it starts with / and use our server
                        if (!tilePath.startsWith("/")) {
                          tilePath = "/" + tilePath;
                        }
                        return `${serverUrl}${tilePath}`;
                      }

                      // Regular tile path - ensure it starts with /
                      if (!tilePath.startsWith("/")) {
                        tilePath = "/" + tilePath;
                      }

                      // Always use tile server URL
                      const finalUrl = `${serverUrl}${tilePath}`;

                      return finalUrl;
                    });
                    // PRESERVE the tileset's own maxzoom (built-in style declares 14)
                    // so mapbox OVERZOOMS beyond it instead of 404-ing the missing
                    // higher zooms and blanking the map. The old code overwrote it
                    // with the camera max — that was the bug. Fall back only if absent.
                    source.minzoom = MAP_MIN_ZOOM;
                    source.maxzoom =
                      source.maxzoom ?? TILE_SOURCE_MAX_NATIVE_ZOOM;
                  }
                });
              }

              // Convert relative glyphs URL to absolute URL
              if (styleJson.glyphs && typeof styleJson.glyphs === "string") {
                if (styleJson.glyphs.startsWith("/")) {
                  styleJson.glyphs = `${serverUrl}${styleJson.glyphs}`;
                }
              } else if (
                styleJson.layers &&
                styleJson.layers.some(
                  (layer: any) => layer.layout && layer.layout["text-field"],
                )
              ) {
                // If glyphs is missing but text layers exist, set default glyphs path
                styleJson.glyphs = `${serverUrl}/fonts/{fontstack}/{range}.pbf`;
              }

              // Set up style.load handler BEFORE applying style
              mapInstance.once("style.load", () => {
                const currentStyle = mapInstance.getStyle();
                // A real style WITH sources loaded → the tiles are present, so clear
                // any spurious "Map Data Not Found" error (e.g. a transient
                // style.error fired during startup). The genuine no-data case takes
                // the catch below and applies an EMPTY style (no sources), so this
                // never clears it. Fixes the dialog appearing over a working map on
                // relaunch.
                if (
                  currentStyle?.sources &&
                  Object.keys(currentStyle.sources).length > 0
                ) {
                  setTileDataError(null);
                }
                // Double-check and force update tile URLs after style loads
                if (currentStyle && currentStyle.sources) {
                  Object.keys(currentStyle.sources).forEach((sourceKey) => {
                    const source = mapInstance.getSource(sourceKey);
                    if (source) {
                      const sourceData = source as any;
                      if (sourceData.type === "vector" && sourceData.tiles) {
                        // Check if any tile URL doesn't start with serverUrl
                        const needsUpdate = sourceData.tiles.some(
                          (url: string) => !url.startsWith(serverUrl),
                        );
                        if (needsUpdate) {
                          console.warn(
                            `[Map] Source ${sourceKey} has incorrect tile URLs, updating...`,
                          );
                          const updatedTiles = sourceData.tiles.map(
                            (tileUrl: string) => {
                              let tilePath = tileUrl;
                              try {
                                const url = new URL(tilePath);
                                tilePath = url.pathname;
                              } catch {}
                              if (
                                tilePath.includes("{z}") ||
                                tilePath.includes("{x}") ||
                                tilePath.includes("{y}")
                              ) {
                                if (!tilePath.startsWith("/"))
                                  tilePath = "/" + tilePath;
                                return `${serverUrl}${tilePath}`;
                              }
                              if (!tilePath.startsWith("/"))
                                tilePath = "/" + tilePath;
                              return `${serverUrl}${tilePath}`;
                            },
                          );
                          try {
                            mapInstance.removeSource(sourceKey);
                            mapInstance.addSource(sourceKey, {
                              type: "vector",
                              tiles: updatedTiles,
                              minzoom: MAP_MIN_ZOOM,
                              // Native max: mapbox overzooms beyond it instead of
                              // 404-ing the missing higher zooms. See constants.
                              maxzoom: TILE_SOURCE_MAX_NATIVE_ZOOM,
                            });
                          } catch (e) {
                            console.error(
                              `[Map] Failed to correct source ${sourceKey}:`,
                              e,
                            );
                          }
                        }
                      }
                    }
                  });
                }
              });

              // Apply the modified style. `{ diff: false }` so the
              // once("style.load") handler registered above actually fires —
              // mapbox only emits that event on the full-load path, and the
              // default diff path would silently skip it (see the detailed note
              // on the other setStyle call).
              mapInstance.setStyle(styleJson, { diff: false });
            } catch (error) {
              console.error("[Map] Failed to fetch and apply style:", error);
              showTileDataError(
                `Map tile data not found at the expected location. Please ensure the ${TILES_FOLDER_NAME} folder is present in Documents/${TILES_FOLDER_NAME} on this device.`,
              );
              mapInstance.setStyle({
                version: 8,
                sources: {},
                layers: [],
              });
            }
          } else {
            // No tile server available — show empty map and prompt user
            mapInstance.setStyle({
              version: 8,
              sources: {},
              layers: [],
            });
            showTileDataError(
              `Map tile data not found at the expected location. Please ensure the ${TILES_FOLDER_NAME} folder is present in Documents/${TILES_FOLDER_NAME} on this device.`,
            );
          }

          mapInstance.once("style.error", (e: any) => {
            console.error("[Map] Style loading error:", e);
            // Ignored if the map already has a working style — a later single-resource
            // 404 (glyph/sprite/tile, often transient on relaunch) is not "not found".
            showTileDataError(
              "Failed to load map style. The tile data may be missing or corrupted at the expected location.",
            );
          });

          mapInstance.setMaxBounds(null);

          // `mapHasTiles` (which gates the "not found" dialog) is driven ONLY by
          // ACTUAL tile loads, never by the mapbox style's source list: a covered
          // mapbox map can hold a style with sources while rendering nothing (in
          // geodetic mode the visible map is the deck view, not mapbox), so a
          // sources-based check would false-positive and hide the dialog over a
          // blank map. Two real-load signals feed it — the fetch interceptor (any
          // tile URL that returns OK, which covers the deck geodetic view) and this
          // mapbox `data` listener (a mapbox tile reaching state "loaded"):
          const onTileData = (e: any) => {
            if (
              e?.dataType === "source" &&
              e?.tile &&
              e.tile.state === "loaded"
            ) {
              setMapHasTiles(true);
            }
          };
          mapInstance.on("data", onTileData);

          // The mapbox instance is ready. Let the custom-basemap apply effect
          // re-run so a basemap restored from a previous session actually gets
          // applied (its first run may have bailed on a not-yet-created map).
          setMapLoaded(true);
        }}
        onClick={handleMapClick}
        onMouseMove={handleMouseMove}
        onMouseUp={() => {
          handleMouseUp();
          handleMouseUpForRubberBand();
        }}
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        dragPan={!rubberBandMode && !isRubberBandDrawing}
        touchZoomRotate={!rubberBandMode && !isRubberBandDrawing}
        onMoveEnd={(e: any) => {
          if (e && e.viewState) {
            // Throttle updates to reduce re-renders during map operations
            if (zoomUpdateTimeoutRef.current) {
              clearTimeout(zoomUpdateTimeoutRef.current);
            }
            zoomUpdateTimeoutRef.current = setTimeout(() => {
              if (typeof e.viewState.zoom === "number") {
                setMapZoom(e.viewState.zoom);
              }
              if (typeof e.viewState.bearing === "number") {
                setMapBearing(e.viewState.bearing);
              }
            }, 100); // Update at most every 100ms
          }
        }}
      >
        <DeckGLOverlay
          overlayRef={deckOverlayRef}
          demRasterPickSuppressRef={demRasterPickSuppressRef}
          // In geodetic mode the geodetic DeckGL owns these layer instances; feed
          // the covered mapbox overlay an empty list so deck.gl doesn't mutate the
          // same instances from two Deck renderers.
          layers={
            geodeticBasemap
              ? []
              : [
                  ...deckGlLayers,
                  // Rubber band overlay layers (render on top)
                  ...(rubberBandRectangle
                    ? Array.isArray(rubberBandRectangle)
                      ? rubberBandRectangle
                      : [rubberBandRectangle]
                    : []),
                  ...(rubberBandOverlay ? [rubberBandOverlay] : []),

                  // Add user location layers LAST so they render on top of everything
                  ...(userLocation && showUserLocation
                    ? [
                        // Add accuracy circle (in meters)
                        ...(userLocation.accuracy > 0
                          ? [
                              new ScatterplotLayer({
                                id: "user-location-accuracy",
                                data: [
                                  {
                                    position: [
                                      userLocation.lng,
                                      userLocation.lat,
                                    ],
                                  },
                                ],
                                getPosition: (d: any) => d.position,
                                getRadius: userLocation.accuracy,
                                radiusUnits: "meters",
                                getFillColor: [59, 130, 246, 20], // Light blue with transparency
                                getLineColor: [59, 130, 246, 100], // Blue border
                                getLineWidth: 1,
                                stroked: true,
                                filled: true,
                                pickable: false,
                                radiusMinPixels: 0,
                                radiusMaxPixels: 1000,
                              }),
                            ]
                          : []),
                        // Add user location marker using IconLayer with proper location icon
                        new IconLayer({
                          id: "user-location-layer",
                          data: [
                            { position: [userLocation.lng, userLocation.lat] },
                          ],
                          getIcon: () => ({
                            url: USER_LOCATION_ICON_URL,
                            width: 24,
                            height: 24,
                            anchorY: 24,
                          }),
                          getPosition: (d: any) => d.position,
                          sizeScale: 1,
                          sizeMinPixels: 24,
                          sizeMaxPixels: 48,
                          pickable: true,
                          pickingRadius: 20,
                          onHover: handleLayerHover,
                        }),
                      ]
                    : []),
                ]
          }
        />
        <NavigationControl
          position="bottom-right"
          showCompass={true}
          showZoom={true}
        />
      </Map>

      {/* EPSG:4326 plate-carrée surface — mounts above the (covered) mapbox map
          only while a 4326 base map is active, so it reaches the full ±90°. */}
      {geodeticBasemap && (
        // No z-index: sits above the (covered) mapbox map by DOM order but stays
        // BELOW the tooltip (zIndex 5) and UI panels (z-50), which must show over it.
        <div className="absolute inset-0">
          <GeodeticBasemapView
            baseUrl={geodeticBasemap.baseUrl}
            config={geodeticBasemap.config}
            cacheKey={basemapActiveId ?? "default"}
            layers={geodeticLayers}
            rasterLayers={geodeticRasterLayers}
            initialCenter={geodeticInitRef.current.center}
            initialZoom={geodeticInitRef.current.zoom}
            commandView={geodeticCommand}
            onViewStateChange={(center, zoom) => {
              geodeticViewRef.current = { center, zoom };
              // Keep the on-screen zoom readout (mapZoom → the "6.13" display, and
              // zoom-dependent layer visibility) in sync with the live geodetic
              // zoom. Throttled via the same ref the mapbox path uses so the
              // deck-managed (uncontrolled) camera stays smooth on low-end
              // devices — no per-frame parent re-render.
              if (zoomUpdateTimeoutRef.current) {
                clearTimeout(zoomUpdateTimeoutRef.current);
              }
              zoomUpdateTimeoutRef.current = setTimeout(() => {
                setMapZoom(orthoZoomToMapbox(zoom));
              }, 100);
            }}
            onMapClick={(pick) =>
              // Route through the same handler mapbox uses so Route Finder A/B
              // placement, drawing, and tap-to-inspect all work in geodetic mode.
              handleMapClick({
                lngLat: { lng: pick.coordinate[0], lat: pick.coordinate[1] },
                coordinate: pick.coordinate,
                point: { x: pick.x, y: pick.y },
                object: pick.object,
                layer: pick.layer,
              })
            }
            onHover={(info) => {
              const i = info as PickingInfo<unknown>;
              if (drawingMode && i?.coordinate) {
                // Keep the drawing preview segment following the cursor; otherwise
                // its endpoint stays stale and draws a stray line to a random point.
                setMousePosition([i.coordinate[0], i.coordinate[1]]);
                return;
              }
              // On TOUCH there is no real hover: after a tap opens a tooltip, deck
              // still emits a hover with no object here, which would instantly close
              // it (the "opens then closes" on Android). Taps drive the tooltip via
              // onMapClick, so ignore hover on coarse pointers — use it only for a
              // desktop mouse, where hovering on/off a feature is the intended way to
              // open/close the tooltip.
              const coarsePointer =
                typeof window !== "undefined" &&
                typeof window.matchMedia === "function" &&
                window.matchMedia("(pointer: coarse)").matches;
              if (coarsePointer) return;
              commitDeckPickToHover(i);
            }}
            // Rubber-band zoom lives inside the geodetic view (the mapbox-based one
            // can't reach this covered surface). Exit the mode after one zoom, to
            // match the mercator behaviour.
            rubberBandMode={rubberBandMode && !drawingMode && !isDrawing}
            onRubberBandComplete={() => setRubberBandMode(false)}
          />
        </div>
      )}

      <Tooltip />
      {/* Settings Button with Paths Info */}
      <SettingsButton />
      {/* COMMENTED OUT: HTML file input - using NativeUploader directly to avoid double picker */}
      <ZoomControls
        mapRef={mapRef}
        zoom={mapZoom}
        bearing={mapBearing}
        onToggleLayersBox={() => {
          const willBeOpen = !(isLayersBoxOpen ?? false);
          if (willBeOpen) {
            setIsMeasurementBoxOpen(false);
            setIsNetworkBoxOpen(false);
            setIsRoutePanelOpen(false);
          }
          onToggleLayersBox?.();
        }}
        isLayersBoxOpen={isLayersBoxOpen}
        isMeasurementBoxOpen={isMeasurementBoxOpen}
        isNetworkBoxOpen={isNetworkBoxOpen}
        onToggleMeasurementBox={() => {
          const willBeOpen = !isMeasurementBoxOpen;
          if (willBeOpen) {
            onCloseLayersBox?.();
            setIsNetworkBoxOpen(false);
            setIsRoutePanelOpen(false);
          }
          setIsMeasurementBoxOpen((prev) => !prev);
        }}
        onToggleNetworkBox={() => {
          const willBeOpen = !isNetworkBoxOpen;
          if (willBeOpen) {
            onCloseLayersBox?.();
            setIsMeasurementBoxOpen(false);
            setIsRoutePanelOpen(false);
          }
          setIsNetworkBoxOpen((prev) => !prev);
        }}
        onUpload={handleUpload}
        onExportLayers={handleExportLayers}
        onSaveSession={handleSaveSession}
        onFlushSession={handleFlushSession}
        onRestoreSession={handleRestoreSession}
        onToggleUserLocation={handleToggleUserLocation}
        onResetHome={handleResetHome}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onCaptureScreenshot={handleCaptureScreenshot}
        showUserLocation={showUserLocation}
        isProcessingFiles={isProcessingFiles}
        isExporting={isExporting}
        cameraPopoverProps={{
          isOpen: isCameraPopoverOpen,
          onOpenChange: setIsCameraPopoverOpen,
          pitch,
          setPitch,
          onCreatePoint: createPointLayer,
        }}
        alertButtonProps={{
          visible: !(
            layers.some(
              (l) =>
                l.type === "nodes" ||
                (l.name || "").includes("Network") ||
                (l.name || "").includes("Connection"),
            ) ||
            (udpLayers != null && udpLayers.length > 0)
          ),
          severity: "warning",
          title: "No network layers on map",
          onClick: () => setShowConnectionError((prev) => !prev),
        }}
        igrsToggleProps={{
          value: useIgrs,
          onToggle: (checked) => setUseIgrs(checked),
        }}
        rubberBandMode={rubberBandMode}
        onToggleRubberBand={() => setRubberBandMode((prev) => !prev)}
        isRoutePanelOpen={isRoutePanelOpen}
        onToggleRoutePanel={() => {
          const willBeOpen = !isRoutePanelOpen;
          if (willBeOpen) {
            onCloseLayersBox?.();
            setIsMeasurementBoxOpen(false);
            setIsNetworkBoxOpen(false);
            lastPersistedRouteKeyRef.current = null;
          }
          if (willBeOpen) {
            setIsRoutePanelOpen(true);
          } else {
            closeRoutePanel();
          }
        }}
        onCloseRoutePanel={closeRoutePanel}
      />

      {/* UDP Config Dialog removed - port is now fixed at 40074, data arrives automatically */}

      <Dialog
        // Fires when the map is genuinely blank — see the effect driving
        // `tileDataErrorConfirmed` (grace period + `!mapHasTiles`). Dismissing sets
        // `tileErrorDismissed` so it can't re-pop over a still-blank map.
        open={tileDataErrorConfirmed}
        onOpenChange={(open) => {
          if (!open) {
            setTileDataError(null);
            setTileErrorDismissed(true);
          }
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Map Data Not Found</DialogTitle>
            <DialogDescription>
              {activeBasemapForError
                ? `Couldn't load map tiles for the selected basemap${activeBasemapForError.label ? ` "${activeBasemapForError.label}"` : ""}. No tiles were found at its saved location below.`
                : (tileDataError ??
                  `Map tile data not found at the expected location. Please ensure the ${TILES_FOLDER_NAME} folder is present in Documents/${TILES_FOLDER_NAME} on this device.`)}
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md bg-muted/50 p-3 text-sm text-muted-foreground space-y-1">
            <p className="font-medium text-foreground">Expected location:</p>
            <p className="font-mono text-xs break-all">{missingTilesPath}</p>
            <p className="mt-2">
              {activeBasemapForError
                ? "Verify the tiles exist at the above location, or pick another basemap folder from Storage Paths."
                : "Copy the map tiles folder to the above location and restart the application."}
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setTileErrorDismissed(true)}
            >
              Dismiss
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                // Re-evaluate from scratch: clear the dismissal and the tile latch,
                // re-init the server, and let the blank-map effect decide again.
                setTileDataError(null);
                setTileErrorDismissed(false);
                setMapHasTiles(false);
                const url = await initializeTileServer(true);
                if (url) {
                  setTileServerUrl(url);
                } else {
                  setTileDataError(
                    "Still unable to find map tile data. Please verify the tiles folder exists at the expected location.",
                  );
                }
              }}
            >
              Retry
            </Button>
            <Button
              onClick={handleChangeBasemapFolder}
              disabled={pickingBasemapFolder}
            >
              {pickingBasemapFolder ? "Opening…" : "Change folder"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default MapComponent;
