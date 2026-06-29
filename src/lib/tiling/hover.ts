// Debounced precise-pixel sampler for tiled rasters.
//
// Debounce duration is chosen by the caller (e.g. shorter on coarse pointers
// for snappier tap-to-inspect on touch devices).
//
// The hook deduplicates concurrent requests: if the cursor moves before a
// previous request returns, the older request's resolve is discarded so
// the tooltip never displays a stale value.

import { useEffect, useRef, useState } from "react";
import { RasterTiling } from "@/plugins/raster-tiling";

interface SamplerCallArgs {
  layerId: string;
  lon: number;
  lat: number;
}

export interface TileSampleState {
  value: number | null;
  dtype: string;
  loading: boolean;
}

const EMPTY: TileSampleState = { value: null, dtype: "", loading: false };

/**
 * Returns a stable sampler function the renderer can call on every mouse
 * move. Internally debounces by `debounceMs` (default 200) and caches the latest result so the
 * caller can read it synchronously via `getLatest()`.
 *
 * Usage:
 *   const sampler = useTileSampler();
 *   onHover: (e) => sampler.request({ layerId, lon: e.coordinate[0], lat: e.coordinate[1] });
 *   const { value, loading } = sampler.state;
 */
export function useTileSampler(debounceMs: number = 200) {
  const [state, setState] = useState<TileSampleState>(EMPTY);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRequestIdRef = useRef(0);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const request = (args: SamplerCallArgs | null) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (!args) {
      setState(EMPTY);
      return;
    }
    setState((s) => ({ ...s, loading: true }));
    const run = () => {
      const myId = ++lastRequestIdRef.current;
      RasterTiling.sampleAt({
        layerId: args.layerId,
        lon: args.lon,
        lat: args.lat,
      })
        .then((r) => {
          if (myId !== lastRequestIdRef.current) return; // stale
          setState({
            value: r.value,
            dtype: r.dtype,
            loading: false,
          });
        })
        .catch(() => {
          if (myId !== lastRequestIdRef.current) return;
          setState({ value: null, dtype: "", loading: false });
        });
    };

    if (debounceMs <= 0) {
      timerRef.current = null;
      run();
    } else {
      timerRef.current = setTimeout(run, debounceMs);
    }
  };

  return { state, request };
}
