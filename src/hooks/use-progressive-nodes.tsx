import type { LayerProps, Node } from "@/lib/definitions";
import { generateLayerId } from "@/lib/layers";
import { useLayers } from "@/store/layers-store";
import { useCallback, useEffect, useState } from "react";

export const useProgressiveNodes = (networkLayersVisible: boolean) => {
  const [nodeCoordinatesData, setNodeCoordinatesData] = useState<
    Array<Array<{ lat: number; lng: number }>>
  >([]);
  const { layers, setLayers } = useLayers();

  const getSignalColor = (
    snr: number,
    rssi: number
  ): [number, number, number] => {
    const normalizedSNR = Math.max(0, Math.min(1, snr / 30));

    const normalizedRSSI = Math.max(0, Math.min(1, (rssi + 100) / 70));

    const signalStrength = normalizedSNR * 0.7 + normalizedRSSI * 0.3;

    if (signalStrength >= 0.7) {
      return [0, 255, 0];
    } else if (signalStrength >= 0.4) {
      return [255, 165, 0];
    } else {
      return [255, 0, 0];
    }
  };

  const createConnectionsLayer = (
    connectionLines: [[number, number], [number, number]][],
    nodes: Node[],
    layerName?: string
  ): LayerProps[] => {
    const connectionLayers: LayerProps[] = connectionLines.map(
      (line, index) => {
        const sourceNode = nodes.find(
          (n) =>
            Math.abs(n.longitude - line[0][0]) < 0.0001 &&
            Math.abs(n.latitude - line[0][1]) < 0.0001
        );
        const targetNode = nodes.find(
          (n) =>
            Math.abs(n.longitude - line[1][0]) < 0.0001 &&
            Math.abs(n.latitude - line[1][1]) < 0.0001
        );

        let signalColor: [number, number, number] = [128, 128, 128];

        if (sourceNode && targetNode) {
          const avgSNR = (sourceNode.snr + targetNode.snr) / 2;
          const avgRSSI = (sourceNode.rssi + targetNode.rssi) / 2;
          signalColor = getSignalColor(avgSNR, avgRSSI);
        }

        return {
          type: "line",
          id: generateLayerId(),
          name: `${layerName || "Nodes"} Connection ${index + 1}`,
          path: [line[0], line[1]],
          color: signalColor,
          lineWidth: 5,
          visible: true,
        };
      }
    );

    return connectionLayers;
  };

  const addConnectionsToLayers = (
    nodes: Node[],
    newLayers: LayerProps[],
    layerName?: string
  ) => {
    const nodeMap = new Map<number, Node>();
    nodes.forEach((node) => {
      nodeMap.set(node.userId, node);
    });

    const connectionLines: [[number, number], [number, number]][] = [];
    const processedConnections = new Set<string>();

    nodes.forEach((sourceNode) => {
      if (
        sourceNode.connectedNodeIds &&
        Array.isArray(sourceNode.connectedNodeIds)
      ) {
        sourceNode.connectedNodeIds.forEach((targetUserId) => {
          const targetNode = nodeMap.get(targetUserId);

          if (targetNode) {
            const connectionId = [sourceNode.userId, targetUserId]
              .sort()
              .join("-");
            if (!processedConnections.has(connectionId)) {
              processedConnections.add(connectionId);
              const connectionLine: [[number, number], [number, number]] = [
                [sourceNode.longitude, sourceNode.latitude],
                [targetNode.longitude, targetNode.latitude],
              ];
              connectionLines.push(connectionLine);
            }
          }
        });
      }
    });

    if (nodes.length >= 2) {
      for (let i = 0; i < Math.min(nodes.length - 1, 3); i++) {
        const testConnection: [[number, number], [number, number]] = [
          [nodes[i].longitude, nodes[i].latitude],
          [nodes[i + 1].longitude, nodes[i + 1].latitude],
        ];
        connectionLines.push(testConnection);
      }
    }

    if (connectionLines.length > 0) {
      const connectionsLayers = createConnectionsLayer(
        connectionLines,
        nodes,
        layerName
      );
      newLayers.push(...connectionsLayers);
    }
  };

  const createNodeLayer = useCallback((nodes: Node[], layerName?: string) => {
    if (!nodes || !Array.isArray(nodes) || nodes.length === 0) {
      return;
    }

    const validNodes = nodes.filter((node) => {
      const isValid =
        node &&
        typeof node.latitude === "number" &&
        typeof node.longitude === "number" &&
        typeof node.userId === "number";

      if (!isValid) {
        console.warn("createNodeLayer: Invalid node structure:", node);
      }
      return isValid;
    });

    if (validNodes.length === 0) {
      return;
    }

    setLayers((currentLayers) => {
      const otherLayers = currentLayers.filter(
        (layer) =>
          layer.type !== "nodes" &&
          !layer.name?.includes("Connections") &&
          !layer.name?.includes("Connection:") &&
          !layer.name?.includes("Connection ")
      );

      const nodeFeatures: GeoJSON.Feature[] = validNodes.map((node, index) => ({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [node.longitude, node.latitude],
        },
        properties: {
          ...node,
          id: index,
        },
      }));

      const nodeGeojson: GeoJSON.FeatureCollection = {
        type: "FeatureCollection",
        features: nodeFeatures,
      };

      const newLayers: LayerProps[] = [];

      const nodesLayer: LayerProps = {
        type: "nodes",
        id: generateLayerId(),
        name:
          layerName ||
          `Nodes Layer ${
            currentLayers.filter((l) => l.type === "nodes").length + 1
          }`,
        geojson: nodeGeojson,
        nodes: validNodes,
        color: [0, 150, 255],
        pointRadius: 30000,
        visible: true,
      };
      newLayers.push(nodesLayer);

      addConnectionsToLayers(validNodes, newLayers, layerName);

      const finalLayers = [...otherLayers, ...newLayers];

      return finalLayers;
    });
  }, []);

  const [currentRowIndex, setCurrentRowIndex] = useState(0);
  const generateProgressiveNodes = () => {
    const nodes: any[] = [];
    const time = Date.now() / 1000;

    if (nodeCoordinatesData.length === 8) {
      for (let i = 0; i < 8; i++) {
        const tabData = nodeCoordinatesData[i];
        if (!tabData || tabData.length === 0) continue;

        const rowIndex = currentRowIndex % tabData.length;
        const coord = tabData[rowIndex];

        const snr = Math.sin(time / 10 + i) * 5 + 15 + Math.random() * 5; // 10-25 dB range
        const rssi = Math.cos(time / 8 + i) * 20 - 60 + Math.random() * 10; // -80 to -40 dBm range
        const distance = Math.abs(Math.sin(time / 15 + i)) * 100000 + 50000;
        const hopCount = i === 0 ? 0 : Math.floor(Math.random() * 4) + 1;

        const connectedNodeIds = [];
        const connectionCount = Math.min(Math.floor(Math.random() * 3) + 1, 7);
        for (let j = 0; j < connectionCount; j++) {
          const connectedId = Math.floor(Math.random() * 8) + 1;
          if (
            connectedId !== i + 1 &&
            !connectedNodeIds.includes(connectedId)
          ) {
            connectedNodeIds.push(connectedId);
          }
        }

        nodes.push({
          userId: i + 1,
          latitude: coord.lat,
          longitude: coord.lng,
          snr: parseFloat(snr.toFixed(1)),
          rssi: parseFloat(rssi.toFixed(1)),
          distance: parseFloat(distance.toFixed(2)),
          hopCount: hopCount,
          connectedNodeIds: connectedNodeIds,
          lastSeen: new Date().toISOString(),
          batteryLevel: Math.floor(Math.random() * 100),
          status: Math.random() > 0.1 ? "online" : "offline",
          isCenterNode: i === 0, // First node is center
        });
      }
    } else {
      for (let i = 1; i <= 8; i++) {
        nodes.push({
          userId: i,
          latitude: 10.8505 + i * 0.1,
          longitude: 76.2711 + i * 0.1,
          snr: 20,
          rssi: -50,
          distance: 10000 * i,
          hopCount: i === 1 ? 0 : 1,
          connectedNodeIds: [],
          lastSeen: new Date().toISOString(),
          batteryLevel: 100,
          status: "online",
          isCenterNode: i === 1,
        });
      }
    }

    return nodes;
  };

  useEffect(() => {
    if (!networkLayersVisible) return;
    if (nodeCoordinatesData.length === 0) return;

    const interval = setInterval(() => {
      setCurrentRowIndex((prev) => prev + 1);

      const progressiveNodes = generateProgressiveNodes();
      createNodeLayer(progressiveNodes, "Progressive Network");
    }, 1000); // Update every 1 second

    // Initial load
    const initialNodes = generateProgressiveNodes();
    createNodeLayer(initialNodes, "Progressive Network");

    return () => clearInterval(interval);
  }, [
    createNodeLayer,
    networkLayersVisible,
    nodeCoordinatesData,
    currentRowIndex,
  ]);

  return {
    nodeCoordinatesData,
    setNodeCoordinatesData,
  };
};
