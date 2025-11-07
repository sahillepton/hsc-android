// @ts-nocheck
import MapComponent from "./components/map";
import { SidebarProvider, SidebarTrigger } from "./components/ui/sidebar";
import { AppSidebar } from "./components/app-sidebar";
import { useSocket } from "./hooks/use-socket";
import { useLayersContext } from "./layers-provider";
import { useEffect } from "react";

const App = () => {
  // Example WebSocket URL - replace with your actual WebSocket endpoint
  const { data: socketData, isConnected } = useSocket("ws://localhost:8080");
  const { createNodeLayer } = useLayersContext();

  // TODO: This should be a custom hook, not in the main component
  useEffect(() => {
    console.log("Socket data received:", socketData);
    console.log("Socket connection status:", isConnected);

    let nodesToProcess = null;

    // Handle different data formats
    if (socketData?.decoded?.nodes && Array.isArray(socketData.decoded.nodes)) {
      console.log("Processing decoded nodes:", socketData.decoded.nodes);
      nodesToProcess = socketData.decoded.nodes;
    } else if (socketData && Array.isArray(socketData)) {
      console.log("Processing direct array nodes:", socketData);
      nodesToProcess = socketData;
    } else if (
      socketData &&
      socketData.nodes &&
      Array.isArray(socketData.nodes)
    ) {
      console.log("Processing nodes property:", socketData.nodes);
      nodesToProcess = socketData.nodes;
    } else {
      console.log("Socket data format not recognized:", socketData);
      return;
    }

    if (nodesToProcess && nodesToProcess.length > 0) {
      console.log("Creating node layer with", nodesToProcess.length, "nodes");

      // Validate node structure
      const validNodes = nodesToProcess.filter((node) => {
        const isValid =
          node &&
          typeof node.latitude === "number" &&
          typeof node.longitude === "number" &&
          typeof node.userId === "number";

        if (!isValid) {
          console.warn("Invalid node structure:", node);
        }
        return isValid;
      });

      console.log(
        "Valid nodes:",
        validNodes.length,
        "out of",
        nodesToProcess.length
      );

      if (validNodes.length > 0) {
        // Save nodes to session storage with timestamp
        const timestamp = new Date().toISOString();
        const nodesWithTimestamp = {
          timestamp,
          nodes: validNodes,
          count: validNodes.length,
        };

        // Get existing data from session storage
        const existingData = sessionStorage.getItem("socketNodes");
        let allNodesData = [];

        if (existingData) {
          try {
            allNodesData = JSON.parse(existingData);
          } catch (error) {
            console.warn(
              "Failed to parse existing session storage data:",
              error
            );
            allNodesData = [];
          }
        }

        // Add new nodes data
        allNodesData.push(nodesWithTimestamp);

        // Keep only last 100 entries to prevent storage overflow
        if (allNodesData.length > 100) {
          allNodesData = allNodesData.slice(-100);
        }

        // Save back to session storage
        sessionStorage.setItem("socketNodes", JSON.stringify(allNodesData));

        // Create node layer with the latest nodes
        createNodeLayer(validNodes, "Live Network Nodes");
      }
    }
  }, [socketData, createNodeLayer]);

  return (
    <SidebarProvider>
      <SidebarTrigger className="absolute top-4 left-4 z-99 h-8 w-8 p-0" />
      <div className="absolute z-50">
        <AppSidebar />
      </div>
      <MapComponent />
    </SidebarProvider>
  );
};

export default App;
