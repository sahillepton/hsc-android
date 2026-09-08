import { create } from "zustand";
import { INITIAL_MAP_ZOOM } from "@/lib/constants";

/**
 * Live camera readout for the on-screen zoom badge and the compass needle.
 *
 * The map component's `mapZoom` / `mapBearing` React state is deliberately
 * throttled to move-END: it feeds zoom-dependent layer visibility, tooltip
 * thresholds and other heavy consumers, so re-rendering the whole map
 * component on every camera frame would stutter low-end devices. The zoom
 * badge and compass needle, however, should follow the camera WHILE the user
 * pinches or scrolls. Keeping just those two numbers in this tiny standalone
 * store lets the badge and the needle subscribe on their own: a camera frame
 * re-renders only those two leaf components, not `<Map>` and not the rest of
 * the ZoomControls toolbar.
 */
interface MapViewState {
  zoom: number;
  bearing: number;
  setView: (zoom: number, bearing?: number) => void;
}

export const useMapViewStore = create<MapViewState>()((set) => ({
  zoom: INITIAL_MAP_ZOOM,
  bearing: 0,
  setView: (zoom, bearing) =>
    set((s) => {
      const nextZoom = Number.isFinite(zoom) ? zoom : s.zoom;
      const nextBearing =
        typeof bearing === "number" && Number.isFinite(bearing)
          ? bearing
          : s.bearing;
      // Returning the same state object skips the update (no subscriber wake-up).
      if (nextZoom === s.zoom && nextBearing === s.bearing) return s;
      return { zoom: nextZoom, bearing: nextBearing };
    }),
}));

/**
 * Imperative setter for map event handlers. Not a hook, so the caller
 * (the map component) does not subscribe and never re-renders because of it.
 * Omitting `bearing` keeps the current one (the geodetic camera has none).
 */
export const setMapView = (zoom: number, bearing?: number) =>
  useMapViewStore.getState().setView(zoom, bearing);

/**
 * Zoom rounded to what the badge prints (2 dp), so the badge re-renders only
 * when a visible digit changes rather than on every sub-pixel camera frame.
 */
export const useLiveZoomDisplay = () =>
  useMapViewStore((s) => Math.round(s.zoom * 100) / 100);

export const useLiveBearing = () => useMapViewStore((s) => s.bearing);
