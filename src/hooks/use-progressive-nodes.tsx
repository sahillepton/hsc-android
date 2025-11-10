import { useEffect, useState } from "react";

export const useProgressiveNodes = (
  networkLayersVisible: boolean,
  createNodeLayer: (nodes: any[], layerName: string) => void
) => {
  const [nodeCoordinatesData, setNodeCoordinatesData] = useState<
    Array<Array<{ lat: number; lng: number }>>
  >([]);

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
