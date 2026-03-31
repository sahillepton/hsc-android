// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ctx: any = self as any;

import {
  EARTH_RADIUS_M,
  METERS_PER_DEGREE_LAT,
  ROUTE_SNAP_TOLERANCE_M,
  ROUTE_BRIDGE_TOLERANCE_MULTIPLIER,
} from "@/lib/constants";

// ─── Haversine distance in meters ────────────────────────────────────────────
function haversine(a: [number, number], b: [number, number]): number {
  const R = EARTH_RADIUS_M;
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLon = ((b[0] - a[0]) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a[1] * Math.PI) / 180) *
      Math.cos((b[1] * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

// ─── MinHeap ─────────────────────────────────────────────────────────────────
class MinHeap {
  h: [number, number][] = [];
  push(item: [number, number]) {
    this.h.push(item);
    this._up(this.h.length - 1);
  }
  pop(): [number, number] {
    const top = this.h[0];
    const last = this.h.pop()!;
    if (this.h.length) {
      this.h[0] = last;
      this._down(0);
    }
    return top;
  }
  _up(i: number) {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.h[p][0] > this.h[i][0]) {
        [this.h[p], this.h[i]] = [this.h[i], this.h[p]];
        i = p;
      } else break;
    }
  }
  _down(i: number) {
    const n = this.h.length;
    while (true) {
      let s = i;
      const l = 2 * i + 1;
      const r = 2 * i + 2;
      if (l < n && this.h[l][0] < this.h[s][0]) s = l;
      if (r < n && this.h[r][0] < this.h[s][0]) s = r;
      if (s !== i) {
        [this.h[s], this.h[i]] = [this.h[i], this.h[s]];
        i = s;
      } else break;
    }
  }
  get size() {
    return this.h.length;
  }
}

// ─── Spatial Grid ────────────────────────────────────────────────────────────
class SpatialGrid<T> {
  cell: number;
  map: Map<string, T[]>;
  constructor(cell: number) {
    this.cell = cell;
    this.map = new Map();
  }
  _k(x: number, y: number) {
    return `${Math.floor(x / this.cell)},${Math.floor(y / this.cell)}`;
  }
  add(x: number, y: number, val: T) {
    const k = this._k(x, y);
    if (!this.map.has(k)) this.map.set(k, []);
    this.map.get(k)!.push(val);
  }
  query(x: number, y: number): T[] {
    const cx = Math.floor(x / this.cell);
    const cy = Math.floor(y / this.cell);
    const out: T[] = [];
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        const arr = this.map.get(`${cx + dx},${cy + dy}`);
        if (arr) for (const v of arr) out.push(v);
      }
    return out;
  }
}

// ─── Graph state ─────────────────────────────────────────────────────────────
let nodes: [number, number][] = [];
let adjList: Record<number, { to: number; w: number }[]> = {};
let graphReady = false;

function progress(message: string, percent?: number) {
  ctx.postMessage({ type: "progress", message, percent });
}

// ─── Snap coord ──────────────────────────────────────────────────────────────
function snapCoord(
  lon: number,
  lat: number,
  snapGrid: SpatialGrid<[number, number]>,
  snapNodes: [number, number][],
  snapTol: number,
): [number, number] {
  const cands = snapGrid.query(lon, lat);
  let best: [number, number] | null = null;
  let bestD = snapTol;
  for (const c of cands) {
    const d = Math.sqrt((lon - c[0]) ** 2 + (lat - c[1]) ** 2);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  if (best) return best;
  const node: [number, number] = [lon, lat];
  snapGrid.add(lon, lat, node);
  snapNodes.push(node);
  return node;
}

// ─── T-intersection ──────────────────────────────────────────────────────────
function pointOnSegInterior(
  p: [number, number],
  a: [number, number],
  b: [number, number],
  snapTol: number,
): number | null {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-20) return null;
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  if (t <= 1e-9 || t >= 1 - 1e-9) return null;
  const ex = a[0] + t * dx - p[0];
  const ey = a[1] + t * dy - p[1];
  if (Math.sqrt(ex * ex + ey * ey) < snapTol) return t;
  return null;
}

// ─── X-intersection ─────────────────────────────────────────────────────────
function segSegIntersect(
  a: [number, number],
  b: [number, number],
  c: [number, number],
  d: [number, number],
): { t: number; u: number } | null {
  const rx = b[0] - a[0],
    ry = b[1] - a[1];
  const sx = d[0] - c[0],
    sy = d[1] - c[1];
  const denom = rx * sy - ry * sx;
  if (Math.abs(denom) < 1e-14) return null;
  const t = ((c[0] - a[0]) * sy - (c[1] - a[1]) * sx) / denom;
  const u = ((c[0] - a[0]) * ry - (c[1] - a[1]) * rx) / denom;
  if (t > 1e-9 && t < 1 - 1e-9 && u > 1e-9 && u < 1 - 1e-9) return { t, u };
  return null;
}

type Segment = {
  a: [number, number];
  b: [number, number];
  splits: number[];
};

// ─── Build Graph ─────────────────────────────────────────────────────────────
function buildGraph(geojson: GeoJSON.FeatureCollection, snapTolMeters: number) {
  const SNAP_TOL = snapTolMeters / METERS_PER_DEGREE_LAT;
  const GRID_CELL = SNAP_TOL * 20;

  // Step 1: Extract polylines
  progress("Extracting polylines…", 5);
  const rawLines: [number, number][][] = [];
  for (const f of geojson.features) {
    const g = f.geometry;
    if (!g) continue;
    const lines: number[][][] =
      g.type === "LineString"
        ? [g.coordinates]
        : g.type === "MultiLineString"
          ? g.coordinates
          : [];
    for (const coords of lines) {
      if (coords.length >= 2)
        rawLines.push(coords.map((c) => [c[0], c[1]] as [number, number]));
    }
  }

  if (rawLines.length === 0) {
    ctx.postMessage({
      type: "graph-built",
      nodeCount: 0,
      edgeCount: 0,
      error: "No line features found in selected layer",
    });
    return;
  }

  // Step 2: Snap vertices
  progress(`Snapping vertices (${snapTolMeters}m tolerance)…`, 15);
  const snapGrid = new SpatialGrid<[number, number]>(SNAP_TOL * 2);
  const snapNodes: [number, number][] = [];
  const snappedLines = rawLines.map((coords) =>
    coords.map((c) => snapCoord(c[0], c[1], snapGrid, snapNodes, SNAP_TOL)),
  );

  // Step 3: Build segment index
  progress("Building segment index…", 30);
  const segments: Segment[] = [];
  const segGrid = new SpatialGrid<Segment>(GRID_CELL);

  for (const line of snappedLines) {
    for (let i = 0; i < line.length - 1; i++) {
      const a = line[i],
        b = line[i + 1];
      if (a === b) continue;
      const seg: Segment = { a, b, splits: [] };
      segments.push(seg);
      const x0 = Math.min(a[0], b[0]),
        x1 = Math.max(a[0], b[0]);
      const y0 = Math.min(a[1], b[1]),
        y1 = Math.max(a[1], b[1]);
      const cx0 = Math.floor(x0 / GRID_CELL),
        cx1 = Math.floor(x1 / GRID_CELL);
      const cy0 = Math.floor(y0 / GRID_CELL),
        cy1 = Math.floor(y1 / GRID_CELL);
      for (let cx = cx0; cx <= cx1; cx++)
        for (let cy = cy0; cy <= cy1; cy++) {
          const key = `${cx},${cy}`;
          if (segGrid.map.has(key)) segGrid.map.get(key)!.push(seg);
          else segGrid.map.set(key, [seg]);
        }
    }
  }

  // Step 4: Detect intersections
  progress(`Detecting intersections (${segments.length} segments)…`, 40);
  let done = 0;
  for (const seg of segments) {
    const minX = Math.min(seg.a[0], seg.b[0]) - GRID_CELL;
    const maxX = Math.max(seg.a[0], seg.b[0]) + GRID_CELL;
    const minY = Math.min(seg.a[1], seg.b[1]) - GRID_CELL;
    const maxY = Math.max(seg.a[1], seg.b[1]) + GRID_CELL;

    const cx0 = Math.floor(minX / GRID_CELL),
      cx1 = Math.ceil(maxX / GRID_CELL);
    const cy0 = Math.floor(minY / GRID_CELL),
      cy1 = Math.ceil(maxY / GRID_CELL);

    const seen = new Set<Segment>();
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        const arr = segGrid.map.get(`${cx},${cy}`);
        if (!arr) continue;
        for (const other of arr) {
          if (other === seg || seen.has(other)) continue;
          seen.add(other);

          const ta = pointOnSegInterior(other.a, seg.a, seg.b, SNAP_TOL);
          if (ta !== null) seg.splits.push(ta);
          const tb = pointOnSegInterior(other.b, seg.a, seg.b, SNAP_TOL);
          if (tb !== null) seg.splits.push(tb);

          const ua = pointOnSegInterior(seg.a, other.a, other.b, SNAP_TOL);
          if (ua !== null) other.splits.push(ua);
          const ub = pointOnSegInterior(seg.b, other.a, other.b, SNAP_TOL);
          if (ub !== null) other.splits.push(ub);

          const xi = segSegIntersect(seg.a, seg.b, other.a, other.b);
          if (xi) {
            seg.splits.push(xi.t);
            other.splits.push(xi.u);
          }
        }
      }
    }

    done++;
    if (done % 2000 === 0) {
      progress(
        `Intersections… ${Math.round((done / segments.length) * 100)}%`,
        40 + Math.round((done / segments.length) * 30),
      );
    }
  }

  // Step 5: Split segments and build adjacency list
  progress("Building graph…", 75);
  nodes = [];
  adjList = {};
  const edges: [number, number][] = [];
  const nodeMap = new Map<[number, number], number>();

  function getIdx(n: [number, number]): number {
    if (nodeMap.has(n)) return nodeMap.get(n)!;
    const idx = nodes.length;
    nodes.push(n);
    nodeMap.set(n, idx);
    return idx;
  }

  function addEdge(nA: [number, number], nB: [number, number]) {
    if (nA === nB) return;
    const ai = getIdx(nA),
      bi = getIdx(nB);
    const d = haversine(nA, nB);
    if (!adjList[ai]) adjList[ai] = [];
    if (!adjList[bi]) adjList[bi] = [];
    adjList[ai].push({ to: bi, w: d });
    adjList[bi].push({ to: ai, w: d });
    edges.push([ai, bi]);
  }

  for (const seg of segments) {
    if (seg.splits.length === 0) {
      addEdge(seg.a, seg.b);
      continue;
    }
    const ts = [...new Set(seg.splits.map((t) => +t.toFixed(10)))].sort(
      (a, b) => a - b,
    );
    const dx = seg.b[0] - seg.a[0],
      dy = seg.b[1] - seg.a[1];
    let prev = seg.a;
    for (const t of ts) {
      const pt = snapCoord(
        seg.a[0] + t * dx,
        seg.a[1] + t * dy,
        snapGrid,
        snapNodes,
        SNAP_TOL,
      );
      addEdge(prev, pt);
      prev = pt;
    }
    addEdge(prev, seg.b);
  }

  // Bridge-gap pass for dangling endpoints
  progress("Bridging gaps…", 85);
  const BRIDGE_TOL = SNAP_TOL * ROUTE_BRIDGE_TOLERANCE_MULTIPLIER;
  const degree = new Int32Array(nodes.length);
  for (const [a, b] of edges) {
    degree[a]++;
    degree[b]++;
  }

  for (let ni = 0; ni < nodes.length; ni++) {
    if (degree[ni] > 2) continue;
    const [nx, ny] = nodes[ni];
    const cx0b = Math.floor((nx - BRIDGE_TOL) / GRID_CELL);
    const cx1b = Math.floor((nx + BRIDGE_TOL) / GRID_CELL);
    const cy0b = Math.floor((ny - BRIDGE_TOL) / GRID_CELL);
    const cy1b = Math.floor((ny + BRIDGE_TOL) / GRID_CELL);

    let bestDist = BRIDGE_TOL;
    let bestPt: [number, number, Segment, number] | null = null;

    for (let cx = cx0b; cx <= cx1b; cx++) {
      for (let cy = cy0b; cy <= cy1b; cy++) {
        const arr = segGrid.map.get(`${cx},${cy}`);
        if (!arr) continue;
        for (const seg of arr) {
          if (seg.a === nodes[ni] || seg.b === nodes[ni]) continue;
          const sdx = seg.b[0] - seg.a[0],
            sdy = seg.b[1] - seg.a[1];
          const len2 = sdx * sdx + sdy * sdy;
          if (len2 < 1e-20) continue;
          const t = Math.max(
            0,
            Math.min(1, ((nx - seg.a[0]) * sdx + (ny - seg.a[1]) * sdy) / len2),
          );
          const px = seg.a[0] + t * sdx,
            py = seg.a[1] + t * sdy;
          const d = Math.sqrt((nx - px) ** 2 + (ny - py) ** 2);
          if (d < bestDist) {
            bestDist = d;
            bestPt = [px, py, seg, t];
          }
        }
      }
    }

    if (bestPt) {
      const [px, py, seg, t] = bestPt;
      const bridgeNode = snapCoord(px, py, snapGrid, snapNodes, SNAP_TOL);
      if (bridgeNode === nodes[ni]) continue;
      addEdge(nodes[ni], bridgeNode);
      if (t > 1e-9 && t < 1 - 1e-9) seg.splits.push(t);
    }
  }

  graphReady = true;
  progress("Graph ready", 100);
  ctx.postMessage({
    type: "graph-built",
    nodeCount: nodes.length,
    edgeCount: edges.length,
  });
}

// ─── Nearest node to a lon/lat ───────────────────────────────────────────────
function nearestNode(lon: number, lat: number): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < nodes.length; i++) {
    const d = haversine([lon, lat], nodes[i]);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

// ─── Dijkstra ────────────────────────────────────────────────────────────────
function dijkstra(src: number, dst: number) {
  const g = new Float64Array(nodes.length).fill(Infinity);
  const prev = new Int32Array(nodes.length).fill(-1);
  const closed = new Uint8Array(nodes.length);
  const pq = new MinHeap();

  g[src] = 0;
  pq.push([0, src]);

  while (pq.size) {
    const [, cur] = pq.pop();
    if (cur === dst) break;
    if (closed[cur]) continue;
    closed[cur] = 1;
    for (const { to, w } of adjList[cur] || []) {
      if (closed[to]) continue;
      const ng = g[cur] + w;
      if (ng < g[to]) {
        g[to] = ng;
        prev[to] = cur;
        pq.push([ng, to]);
      }
    }
  }

  if (g[dst] === Infinity) return null;
  const path: number[] = [];
  let c = dst;
  while (c !== -1) {
    path.unshift(c);
    c = prev[c];
  }
  return { path, dist: g[dst] };
}

// ─── A* ──────────────────────────────────────────────────────────────────────
function astar(src: number, dst: number) {
  const h = (i: number) => haversine(nodes[i], nodes[dst]);
  const g = new Float64Array(nodes.length).fill(Infinity);
  const prev = new Int32Array(nodes.length).fill(-1);
  const closed = new Uint8Array(nodes.length);
  const pq = new MinHeap();

  g[src] = 0;
  pq.push([h(src), src]);

  while (pq.size) {
    const [, cur] = pq.pop();
    if (cur === dst) break;
    if (closed[cur]) continue;
    closed[cur] = 1;
    for (const { to, w } of adjList[cur] || []) {
      if (closed[to]) continue;
      const ng = g[cur] + w;
      if (ng < g[to]) {
        g[to] = ng;
        prev[to] = cur;
        pq.push([ng + h(to), to]);
      }
    }
  }

  if (g[dst] === Infinity) return null;
  const path: number[] = [];
  let c = dst;
  while (c !== -1) {
    path.unshift(c);
    c = prev[c];
  }
  return { path, dist: g[dst] };
}

// ─── Find path ───────────────────────────────────────────────────────────────
function findPath(
  startLonLat: [number, number],
  endLonLat: [number, number],
  algo: "dijkstra" | "astar" = "dijkstra",
) {
  if (!graphReady) {
    ctx.postMessage({
      type: "path-result",
      error: "Graph not built yet",
    });
    return;
  }

  const src = nearestNode(startLonLat[0], startLonLat[1]);
  const dst = nearestNode(endLonLat[0], endLonLat[1]);

  const result = algo === "astar" ? astar(src, dst) : dijkstra(src, dst);
  if (!result) {
    ctx.postMessage({
      type: "path-result",
      error: "No path found. Points may be on disconnected road segments.",
    });
    return;
  }

  const pathCoords: [number, number][] = result.path.map((i) => nodes[i]);

  ctx.postMessage({
    type: "path-result",
    path: pathCoords,
    dist: result.dist,
    segments: result.path.length - 1,
    algo,
  });
}

// ─── Snap point (return nearest point on any edge, or nearest node) ─────────
function snapPoint(lonLat: [number, number], tag: string) {
  if (!graphReady) {
    ctx.postMessage({ type: "snap-result", tag, error: "Graph not built" });
    return;
  }

  const [lon, lat] = lonLat;
  const nodeCount = nodes.length;

  // Find nearest existing node
  const ni = nearestNode(lon, lat);
  let bestDist = haversine(lonLat, nodes[ni]);
  let bestCoord: [number, number] = nodes[ni];
  let bestEdge: { from: number; to: number } | null = null;

  // Check nearest point on every edge — may be closer than any node
  for (let i = 0; i < nodeCount; i++) {
    const neighbors = adjList[i];
    if (!neighbors) continue;
    for (const { to } of neighbors) {
      if (to <= i) continue;
      const a = nodes[i],
        b = nodes[to];
      const dx = b[0] - a[0],
        dy = b[1] - a[1];
      const len2 = dx * dx + dy * dy;
      if (len2 < 1e-20) continue;
      const t = ((lon - a[0]) * dx + (lat - a[1]) * dy) / len2;
      if (t <= 1e-9 || t >= 1 - 1e-9) continue;
      const px = a[0] + t * dx,
        py = a[1] + t * dy;
      const d = haversine(lonLat, [px, py]);
      if (d < bestDist) {
        bestDist = d;
        bestCoord = [px, py];
        bestEdge = { from: i, to };
      }
    }
  }

  // If the closest point is on an edge interior, insert a virtual node
  if (bestEdge) {
    const vi = nodes.length;
    nodes.push(bestCoord);
    const dA = haversine(nodes[bestEdge.from], bestCoord);
    const dB = haversine(bestCoord, nodes[bestEdge.to]);
    if (!adjList[vi]) adjList[vi] = [];
    adjList[vi].push({ to: bestEdge.from, w: dA }, { to: bestEdge.to, w: dB });
    adjList[bestEdge.from].push({ to: vi, w: dA });
    adjList[bestEdge.to].push({ to: vi, w: dB });
  }

  ctx.postMessage({
    type: "snap-result",
    tag,
    snapped: bestCoord,
    dist: bestDist,
  });
}

// ─── Message handler ─────────────────────────────────────────────────────────
ctx.onmessage = (ev: MessageEvent) => {
  const msg = ev.data;
  switch (msg.type) {
    case "build-graph":
      graphReady = false;
      nodes = [];
      adjList = {};
      buildGraph(msg.geojson, msg.snapTolMeters ?? ROUTE_SNAP_TOLERANCE_M);
      break;
    case "find-path":
      findPath(msg.startLonLat, msg.endLonLat, msg.algo ?? "dijkstra");
      break;
    case "snap-point":
      snapPoint(msg.lonLat, msg.tag);
      break;
  }
};
