import { useState, useEffect } from "react";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
} from "../ui/sidebar";
import { ChevronDown, ChevronRight, LocateFixed, Info } from "lucide-react";
import { Virtuoso } from "react-virtuoso";
import { Button } from "../ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "../ui/label";
import {
  useNetworkLayersVisible,
  useIgrsPreference,
} from "@/store/layers-store";
import { useUdpLayers } from "@/components/map/udp-layers";
import { useUdpDataStore } from "@/store/udp-data-store";
import { useUdpSymbolsStore } from "@/store/udp-symbols-store";
import UdpLayerConfigPopover from "./udp-layer-config-popover";
import { calculateIgrs } from "@/lib/utils";

const snrLevels = [
  { label: "Poor", range: "0-24", color: "#DC2626" },
  { label: "Medium", range: "25-49", color: "#F97316" },
  { label: "Good", range: "50-74", color: "#EAB308" },
  { label: "High", range: "75-100", color: "#16A34A" },
] as const;

// All available icons for mother node selection
const motherNodeIcons = [
  "mother-fighter",
  "fighter1",
  "fighter2",
  "fighter3",
  "fighter4",
  "fighter5",
  "fighter6",
  "fighter7",
  "fighter8",
  "fighter9",
  "fighter10",
  "fighter11",
  "fighter12",
  "fighter13",
  "fighter14",
  "helicopter1",
];

type NetworkLayersPanelProps = {
  isOpen: boolean;
  setIsOpen: (value: boolean) => void;
  variant?: "accordion" | "plain";
  enableSelection?: boolean;
};

const NetworkLayersPanel = ({
  isOpen,
  setIsOpen,
  variant = "accordion",
}: NetworkLayersPanelProps) => {
  const { networkLayersVisible, setNetworkLayersVisible } =
    useNetworkLayersVisible();
  const { udpLayers } = useUdpLayers();
  const useIgrs = useIgrsPreference();
  const [focusedLayerId, setFocusedLayerId] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const topologyData = useUdpDataStore((state) => state.udpData.topology);
  const {
    motherNodeSymbol,
    setMotherNodeSymbol,
    groupSymbols,
    snrLineWidths,
    setSnrLineWidths,
  } = useUdpSymbolsStore();
  const effectiveSnrLineWidths: [number, number, number, number] = [
    snrLineWidths[0] ?? 1,
    snrLineWidths[1] ?? 3,
    snrLineWidths[2] ?? 5,
    snrLineWidths[3] ?? 7,
  ];
  const [showMotherIconPicker, setShowMotherIconPicker] = useState(false);

  // Get UDP layer data - only network members
  const networkMembersLayer = udpLayers.find(
    (layer: any) => layer?.id === "udp-network-members-layer",
  );

  const networkMembersData = networkMembersLayer?.props?.data || [];

  // Detect topology groups (connected components)
  const detectTopologyGroups = () => {
    if (topologyData.nodes.size === 0) {
      return [];
    }

    const groups: Array<{
      id: string;
      nodeIds: Set<number>;
      connections: Array<{ from: number; to: number; snr: number }>;
    }> = [];
    const visited = new Set<number>();
    const nodeIds = Array.from(topologyData.nodes.keys());

    // BFS to find connected components
    const bfs = (startNodeId: number, groupId: string) => {
      const queue = [startNodeId];
      const groupNodeIds = new Set<number>();
      const groupConnections: Array<{ from: number; to: number; snr: number }> =
        [];

      while (queue.length > 0) {
        const currentNodeId = queue.shift()!;
        if (visited.has(currentNodeId)) continue;

        visited.add(currentNodeId);
        groupNodeIds.add(currentNodeId);

        const node = topologyData.nodes.get(currentNodeId);
        if (!node) continue;

        // Add neighbors to queue (only if they exist in topologyData.nodes)
        node.neighbors.forEach((neighbor) => {
          // Only traverse to neighbors that exist in the nodes Map
          // This prevents creating separate groups for nodes that aren't in the current snapshot
          const neighborNode = topologyData.nodes.get(neighbor.id);
          if (neighborNode && !visited.has(neighbor.id)) {
            queue.push(neighbor.id);
          }

          // Add connection to group (only if both nodes exist)
          if (neighborNode) {
            const smallerId = Math.min(currentNodeId, neighbor.id);
            const largerId = Math.max(currentNodeId, neighbor.id);
            const connectionKey = `${smallerId}_${largerId}`;
            const snr = topologyData.connections.get(connectionKey);
            if (snr !== undefined) {
              // Check if connection already added
              const exists = groupConnections.some(
                (c) =>
                  (c.from === smallerId && c.to === largerId) ||
                  (c.from === largerId && c.to === smallerId),
              );
              if (!exists) {
                groupConnections.push({ from: smallerId, to: largerId, snr });
              }
            }
          }
        });
      }

      if (groupNodeIds.size > 0) {
        groups.push({
          id: groupId,
          nodeIds: groupNodeIds,
          connections: groupConnections,
        });
      }
    };

    // Find all groups
    let groupIndex = 0;
    for (const nodeId of nodeIds) {
      if (!visited.has(nodeId)) {
        const groupId = String.fromCharCode(65 + groupIndex); // A, B, C, ...
        bfs(nodeId, groupId);
        groupIndex++;
      }
    }

    return groups;
  };

  // Smooth focus animation: zoom out first, then fly to target with parabolic motion
  const handleFocusLayer = () => {
    setFocusedLayerId("udp-network-members-layer");
    if (!networkMembersData || networkMembersData.length === 0) {
      return;
    }

    const mapRef = (window as any).mapRef;
    if (!mapRef?.current) return;

    const map = mapRef.current.getMap();
    const data = networkMembersData;

    // Calculate bounds from data
    let minLng = Infinity;
    let maxLng = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;

    data.forEach((item: any) => {
      if (item.longitude !== undefined && item.latitude !== undefined) {
        minLng = Math.min(minLng, item.longitude);
        maxLng = Math.max(maxLng, item.longitude);
        minLat = Math.min(minLat, item.latitude);
        maxLat = Math.max(maxLat, item.latitude);
      }
    });

    if (
      minLng !== Infinity &&
      maxLng !== -Infinity &&
      minLat !== Infinity &&
      maxLat !== -Infinity
    ) {
      const currentZoom = map.getZoom();
      const currentBounds = map.getBounds();

      // Check if current view already contains the bounds
      const boundsContained =
        currentBounds.getWest() <= minLng &&
        currentBounds.getEast() >= maxLng &&
        currentBounds.getSouth() <= minLat &&
        currentBounds.getNorth() >= maxLat;
      const zoomDiff = Math.abs(currentZoom - 12); // Rough check
      const isAlreadyFocused = boundsContained && zoomDiff < 1;

      if (isAlreadyFocused) {
        // Already focused, don't animate
        return;
      }

      // Calculate zoom based on bounding box size
      const lngSpan = maxLng - minLng;
      const latSpan = maxLat - minLat;
      const maxSpan = Math.max(lngSpan, latSpan);

      // Calculate appropriate maxZoom based on bounding box size
      let calculatedMaxZoom: number;
      if (maxSpan < 0.001) {
        calculatedMaxZoom = 20;
      } else if (maxSpan < 0.01) {
        calculatedMaxZoom = 18;
      } else if (maxSpan < 0.1) {
        calculatedMaxZoom = 15;
      } else if (maxSpan < 1) {
        calculatedMaxZoom = 12;
      } else if (maxSpan < 10) {
        calculatedMaxZoom = 8;
      } else {
        calculatedMaxZoom = 5;
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
          padding: { top: 50, bottom: 50, left: 50, right: 50 },
          duration: 2000, // Smooth, slower duration
          maxZoom: calculatedMaxZoom, // Zoom based on bounding box size
          linear: false, // Use default easing (smooth)
        },
      );
    }
  };

  // Focus on a specific topology group
  const handleFocusGroup = (group: { id: string; nodeIds: Set<number> }) => {
    setFocusedLayerId(`topology-group-${group.id}`);
    if (group.nodeIds.size === 0) {
      return;
    }

    const mapRef = (window as any).mapRef;
    if (!mapRef?.current) return;

    const map = mapRef.current.getMap();
    const nodes = Array.from(group.nodeIds)
      .map((nodeId) => topologyData.nodes.get(nodeId))
      .filter((node) => node !== undefined);

    // Calculate bounds from group nodes
    let minLng = Infinity;
    let maxLng = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;

    nodes.forEach((node) => {
      if (node && node.long !== undefined && node.lat !== undefined) {
        minLng = Math.min(minLng, node.long);
        maxLng = Math.max(maxLng, node.long);
        minLat = Math.min(minLat, node.lat);
        maxLat = Math.max(maxLat, node.lat);
      }
    });

    if (
      minLng !== Infinity &&
      maxLng !== -Infinity &&
      minLat !== Infinity &&
      maxLat !== -Infinity
    ) {
      // Calculate zoom based on bounding box size
      const lngSpan = maxLng - minLng;
      const latSpan = maxLat - minLat;
      const maxSpan = Math.max(lngSpan, latSpan);

      // Calculate appropriate maxZoom based on bounding box size
      let calculatedMaxZoom: number;
      if (maxSpan < 0.001) {
        calculatedMaxZoom = 20;
      } else if (maxSpan < 0.01) {
        calculatedMaxZoom = 18;
      } else if (maxSpan < 0.1) {
        calculatedMaxZoom = 15;
      } else if (maxSpan < 1) {
        calculatedMaxZoom = 12;
      } else if (maxSpan < 10) {
        calculatedMaxZoom = 8;
      } else {
        calculatedMaxZoom = 5;
      }

      map.stop();
      map.fitBounds(
        [
          [minLng, minLat],
          [maxLng, maxLat],
        ],
        {
          padding: { top: 50, bottom: 50, left: 50, right: 50 },
          duration: 2000,
          maxZoom: calculatedMaxZoom, // Zoom based on bounding box size
          linear: false,
        },
      );
    }
  };

  const formatCoordinate = (lat: number, lng: number) => {
    if (useIgrs) {
      // calculateIgrs expects (longitude, latitude)
      const igrs = calculateIgrs(lng, lat);
      return {
        value: igrs || `${lat.toFixed(6)}° , ${lng.toFixed(6)}°`,
        isIgrsAvailable: igrs !== null,
      };
    }
    return {
      value: `${lat.toFixed(6)}° , ${lng.toFixed(6)}°`,
      isIgrsAvailable: true, // Not using IGRS, so no issue
    };
  };

  const toggleGroupExpansion = (groupId: string) => {
    setExpandedGroups((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(groupId)) {
        newSet.delete(groupId);
      } else {
        newSet.add(groupId);
      }
      return newSet;
    });
  };

  // Initialize all groups as expanded by default when topology groups change
  const topologyGroups = detectTopologyGroups();
  useEffect(() => {
    if (topologyGroups.length > 0) {
      const allGroupIds = topologyGroups.map((g) => g.id);
      setExpandedGroups((prev) => {
        const newSet = new Set(prev);
        allGroupIds.forEach((id) => {
          if (!newSet.has(id)) {
            newSet.add(id);
          }
        });
        return newSet;
      });
    }
  }, [topologyGroups.map((g) => g.id).join(",")]);

  // Collect active group icons (to disable them in mother node picker)
  const activeGroupIconSet = new Set<string>();
  const defaultGroupIcons: Record<string, string> = {
    A: "fighter1",
    B: "fighter2",
    C: "fighter3",
    D: "fighter4",
    E: "fighter5",
    F: "fighter6",
    G: "fighter7",
    H: "fighter8",
    I: "fighter9",
    J: "fighter10",
  };
  topologyGroups.forEach((group) => {
    const key = `topology-group-${group.id}`;
    const sym = groupSymbols[key] || defaultGroupIcons[group.id] || "fighter1";
    activeGroupIconSet.add(sym);
  });

  const renderLegend = () => {
    const hasTopology = topologyData.nodes.size > 0;
    if (!hasTopology) return null;

    // Current mother icon
    const currentMotherIcon = motherNodeSymbol || "mother-fighter";

    // Get a sample group icon for the legend
    const sampleGroupIcon =
      topologyGroups.length > 0
        ? groupSymbols[`topology-group-${topologyGroups[0].id}`] ||
          defaultGroupIcons[topologyGroups[0].id] ||
          "fighter1"
        : "fighter1";

    return (
      <div className="mb-3">
        <div className="rounded-2xl border border-border/60 bg-white/90 p-4 shadow-sm">
          <div className="text-[13px] font-semibold text-foreground mb-3">
            Legend
          </div>

          {/* SNR Legend + Width Controls (single compact section) */}
          <div className="mb-3">
            <div className="flex items-center justify-between mb-1.5">
              <div className="text-[11px] font-medium text-zinc-600">
                SNR (Signal-to-Noise Ratio)
              </div>
              <button
                onClick={() => {
                  setSnrLineWidths([1, 3, 5, 7]);
                }}
                className="text-[9px] text-zinc-400 hover:text-zinc-600 px-1.5 py-1 rounded hover:bg-zinc-100 transition-colors"
                title="Reset SNR line widths to defaults"
              >
                Reset Widths
              </button>
            </div>
            <div className="text-[9px] text-zinc-400 mb-2">
              Colors are fixed for consistency; line width can be adjusted.
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {snrLevels.map((level, idx) => {
                const widthValue = effectiveSnrLineWidths[idx];
                return (
                  <div
                    key={level.label}
                    className="rounded-md border border-border/40 bg-zinc-50/80 px-2 py-1.5"
                  >
                    <div className="flex items-center justify-between gap-1">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span
                          className="h-2.5 w-2.5 rounded-full border border-zinc-300 shrink-0"
                          style={{ backgroundColor: level.color }}
                        />
                        <span className="text-[9px] font-semibold text-zinc-700">
                          {level.label}
                        </span>
                        <span className="text-[9px] text-zinc-500 truncate">
                          {level.range}
                        </span>
                      </div>
                      <div className="flex items-center gap-0.5">
                        <button
                          onClick={() => {
                            if (widthValue <= 1) return;
                            const updated = [...effectiveSnrLineWidths] as [
                              number,
                              number,
                              number,
                              number,
                            ];
                            updated[idx] = widthValue - 1;
                            setSnrLineWidths(updated);
                          }}
                          className="w-5 h-5 flex items-center justify-center rounded border border-zinc-300 hover:bg-zinc-100 text-[9px] text-zinc-600 transition-colors"
                          title="Decrease width"
                        >
                          −
                        </button>
                        <span className="w-4 text-center text-[9px] font-mono text-zinc-700 font-semibold">
                          {widthValue}
                        </span>
                        <button
                          onClick={() => {
                            if (widthValue >= 12) return;
                            const updated = [...effectiveSnrLineWidths] as [
                              number,
                              number,
                              number,
                              number,
                            ];
                            updated[idx] = widthValue + 1;
                            setSnrLineWidths(updated);
                          }}
                          className="w-5 h-5 flex items-center justify-center rounded border border-zinc-300 hover:bg-zinc-100 text-[9px] text-zinc-600 transition-colors"
                          title="Increase width"
                        >
                          +
                        </button>
                      </div>
                    </div>
                    <div
                      className="rounded-full mt-1"
                      style={{
                        width: "100%",
                        height: `${widthValue}px`,
                        backgroundColor: level.color,
                      }}
                    />
                  </div>
                );
              })}
            </div>
          </div>

          {/* Node Icons */}
          <div className="flex items-center gap-4 mt-2">
            {/* Mother Node */}
            <div className="flex items-center gap-1.5">
              <img
                src={`icons/${currentMotherIcon}.svg`}
                alt="Mother Node"
                className="w-5 h-5"
              />
              <span className="text-[11px] text-zinc-600">Mother Node</span>
            </div>

            {/* Topology Node */}
            <div className="flex items-center gap-1.5">
              <img
                src={`icons/${sampleGroupIcon}.svg`}
                alt="Topology Node"
                className="w-5 h-5"
              />
              <span className="text-[11px] text-zinc-600">Topology Node</span>
            </div>
          </div>

          {/* Mother Node Icon Config */}
          <div className="mt-3 pt-3 border-t border-border/40">
            <div className="flex items-center justify-between">
              <div className="text-[11px] font-medium text-zinc-600">
                Mother Node Icon
              </div>
              <button
                onClick={() => setShowMotherIconPicker(!showMotherIconPicker)}
                className="flex items-center gap-1.5 px-2 py-1 rounded-md border border-border/60 hover:bg-zinc-50 transition-colors"
              >
                <img
                  src={`icons/${currentMotherIcon}.svg`}
                  alt="Current"
                  className="w-4 h-4"
                />
                <span className="text-[10px] text-zinc-500">Change</span>
                <svg
                  className={`w-3 h-3 text-zinc-400 transition-transform ${
                    showMotherIconPicker ? "rotate-180" : ""
                  }`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </button>
            </div>

            {showMotherIconPicker && (
              <div className="mt-2 grid grid-cols-6 gap-1">
                {motherNodeIcons.map((iconName) => {
                  const isSelected = currentMotherIcon === iconName;
                  const isUsedByGroup = activeGroupIconSet.has(iconName);
                  return (
                    <button
                      key={iconName}
                      disabled={isUsedByGroup && iconName !== "mother-fighter"}
                      onClick={() => {
                        setMotherNodeSymbol(iconName);
                        setShowMotherIconPicker(false);
                      }}
                      className={`flex items-center justify-center p-1.5 rounded border transition-all ${
                        isSelected
                          ? "border-blue-500 bg-blue-100 ring-2 ring-blue-400"
                          : isUsedByGroup && iconName !== "mother-fighter"
                            ? "border-gray-200 bg-gray-100 opacity-40 cursor-not-allowed"
                            : "border-gray-300 hover:border-blue-400 hover:bg-gray-50"
                      }`}
                      title={
                        isUsedByGroup && iconName !== "mother-fighter"
                          ? `Used by group nodes`
                          : iconName.replace(/-/g, " ")
                      }
                    >
                      <img
                        src={`icons/${iconName}.svg`}
                        alt={iconName}
                        className="w-4 h-4"
                      />
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderTopologyGroups = () => {
    if (topologyGroups.length === 0) {
      return null;
    }

    return (
      <>
        {topologyGroups.map((group) => {
          const isGroupFocused =
            focusedLayerId === `topology-group-${group.id}`;
          const isExpanded = expandedGroups.has(group.id);

          return (
            <div key={group.id} className="mb-3">
              <div
                className={`relative rounded-2xl border border-border/60 bg-white/90 p-4 shadow-sm ${
                  isGroupFocused ? "border-l-4 border-l-sky-300" : ""
                }`}
              >
                <div className="absolute right-3 top-3 flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    title={`Focus Group ${group.id}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleFocusGroup(group);
                    }}
                  >
                    <LocateFixed size={10} />
                  </Button>
                  <div onClick={(e) => e.stopPropagation()}>
                    <UdpLayerConfigPopover
                      layerId={`topology-group-${group.id}`}
                      layerName={`Group ${group.id}`}
                    />
                  </div>
                </div>

                <div className="min-w-0 pr-14">
                  <div
                    className="flex items-start gap-2 cursor-pointer select-none"
                    onClick={() => toggleGroupExpansion(group.id)}
                  >
                    <div className="flex items-center gap-2">
                      {isExpanded ? (
                        <ChevronDown
                          size={14}
                          className="text-muted-foreground"
                        />
                      ) : (
                        <ChevronRight
                          size={14}
                          className="text-muted-foreground"
                        />
                      )}
                      <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
                        <span className="truncate text-[16px]">
                          Group {group.id}
                        </span>
                      </div>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="mt-3 border-t border-border/40 pt-3 w-full">
                      {group.connections.length > 0 ? (
                        <>
                          <div className="text-[12px] font-semibold text-zinc-700 mb-2">
                            Connections:
                          </div>
                          <div className="space-y-1">
                            {group.connections.map((conn, idx) => (
                              <div
                                key={idx}
                                className="text-[12px] font-mono text-zinc-600"
                              >
                                {conn.from} ↔ {conn.to} (SNR {conn.snr})
                              </div>
                            ))}
                          </div>
                        </>
                      ) : (
                        <div className="space-y-1">
                          {Array.from(group.nodeIds).map((nodeId) => (
                            <div
                              key={nodeId}
                              className="text-[12px] font-mono text-zinc-600"
                            >
                              Node {nodeId}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </>
    );
  };

  const renderList = () => {
    // When network layers are toggled off, hide data from panel too
    if (!networkLayersVisible) {
      return (
        <div className="text-center text-sm text-muted-foreground py-3">
          Network layers are hidden
        </div>
      );
    }

    const hasNetworkMembers = networkMembersData.length > 0;
    const hasTopologyData = topologyData.nodes.size > 0;

    if (!hasNetworkMembers && !hasTopologyData) {
      return (
        <div className="text-center text-sm text-muted-foreground py-3">
          No network data yet
        </div>
      );
    }

    const isFocused = focusedLayerId === "udp-network-members-layer";

    return (
      <div className="space-y-3">
        {hasNetworkMembers && (
          <div className="mb-3">
            <div
              className={`relative rounded-2xl border border-border/60 bg-white/90 p-4 shadow-sm ${
                isFocused ? "border-l-4 border-l-sky-300" : ""
              }`}
            >
              <div className="absolute right-3 top-3 flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  title="Focus Network Members"
                  onClick={() => handleFocusLayer()}
                >
                  <LocateFixed size={10} />
                </Button>
                <UdpLayerConfigPopover
                  layerId="udp-network-members-layer"
                  layerName="Network Members"
                />
              </div>

              <div className="min-w-0 pr-14">
                <div className="flex items-start gap-2">
                  <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
                    <span className="truncate text-[16px]">
                      Network Members
                    </span>
                  </div>
                </div>

                {networkMembersData.length > 0 && (
                  <div className="mt-3 border-t border-border/40 pt-3 w-full">
                    <div className="border border-border/20 rounded-lg overflow-hidden w-full">
                      <Virtuoso
                        style={{
                          height: `${Math.min(
                            networkMembersData.length * 48 + 2,
                            384,
                          )}px`,
                          width: "100% !important",
                        }}
                        data={networkMembersData}
                        increaseViewportBy={200}
                        itemContent={(idx, item: any) => {
                          const globalId = item.globalId ?? item.id ?? idx;
                          const coord = formatCoordinate(
                            item.latitude,
                            item.longitude,
                          );

                          return (
                            <div className="py-3 px-3 border-b border-border/20 last:border-b-0 bg-white hover:bg-zinc-50/50 transition-colors">
                              <div className="space-y-2">
                                <div className="flex items-center gap-2">
                                  <span className="font-semibold text-[12px] text-black">
                                    Global ID:
                                  </span>
                                  <span className="font-mono text-[12px] text-zinc-500">
                                    {globalId}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-semibold text-[12px] text-black">
                                    Location:
                                  </span>
                                  <span className="font-mono text-[12px] text-zinc-500 flex items-center gap-1">
                                    {coord.value}
                                    {useIgrs && !coord.isIgrsAvailable && (
                                      <div className="relative group">
                                        <Info
                                          size={12}
                                          className="text-muted-foreground cursor-help"
                                        />
                                        <div className="absolute -left-2 bottom-full mb-1 hidden group-hover:block z-10 bg-black text-white text-[10px] px-2 py-1 rounded whitespace-nowrap">
                                          IGRS not available
                                        </div>
                                      </div>
                                    )}
                                  </span>
                                </div>
                              </div>
                            </div>
                          );
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
        {hasTopologyData && renderLegend()}
        {hasTopologyData && renderTopologyGroups()}
      </div>
    );
  };

  if (variant === "plain") {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between px-3 py-2">
          <label className="flex items-center gap-2 font-medium text-foreground text-sm">
            <Switch
              id="show-network-layers-panel"
              checked={networkLayersVisible}
              onCheckedChange={setNetworkLayersVisible}
            />
            <Label htmlFor="show-network-layers-panel">
              Show Network Layers
            </Label>
          </label>
        </div>
        {renderList()}
      </div>
    );
  }

  return (
    <SidebarGroup>
      <SidebarGroupLabel
        className="flex items-center justify-between cursor-pointer select-none font-semibold px-2 py-2.5 rounded-lg hover:bg-accent transition-colors"
        onClick={() => setIsOpen(!isOpen)}
      >
        <span className="text-sm">Network Layers</span>
        {isOpen ? (
          <ChevronDown size={16} className="text-muted-foreground" />
        ) : (
          <ChevronRight size={16} className="text-muted-foreground" />
        )}
      </SidebarGroupLabel>

      <SidebarGroupContent
        className={`${isOpen ? "block" : "hidden"} transition-all relative`}
      >
        {renderList()}
      </SidebarGroupContent>
    </SidebarGroup>
  );
};

export default NetworkLayersPanel;
