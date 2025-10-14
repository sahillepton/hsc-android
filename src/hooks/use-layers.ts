import type { LayerProps, Node } from "@/lib/definitions";
import { useState, useCallback, useEffect } from "react";
import { ScatterplotLayer, PolygonLayer, LineLayer, GeoJsonLayer, IconLayer } from "@deck.gl/layers";
import { showMessage, getUploadData, removeUploadData, getDownloadData, removeDownloadData, readFileFromFilesystem, deleteFileFromFilesystem, listFilesInDirectory, getFileInfo } from "@/lib/capacitor-utils";
import  type {PickingInfo} from '@deck.gl/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';

export const useLayers = () => {
    const [layers, setLayers] = useState<LayerProps[]>([]);
    const [isDrawing, setIsDrawing] = useState(false);
    const [currentPath, setCurrentPath] = useState<[number, number][]>([]);
    const [dragStart, setDragStart] = useState<[number, number] | null>(null);
    const [drawingMode, setDrawingMode] = useState<"point" | "polygon" | "line" | null>(
      null
    );
    const [selectedNode, setSelectedNode] = useState<Node | null>(null);
    const [isNodeDialogOpen, setIsNodeDialogOpen] = useState(false);
    const [hoverInfo, setHoverInfo] = useState<PickingInfo<LayerProps>>();
    const [mousePosition, setMousePosition] = useState<[number, number] | null>(
        null
      );
    const [networkLayersVisible, setNetworkLayersVisible] = useState(true);
    const [nodeIconMappings, setNodeIconMappings] = useState<Record<string, string>>({});

    // Handle Escape key to exit drawing mode
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && drawingMode) {
                console.log("Escape key pressed, exiting drawing mode");
                setDrawingMode(null);
                setIsDrawing(false);
                setCurrentPath([]);
                setDragStart(null);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [drawingMode]);
    
   const generateLayerId = () => {
    return `layer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
   }

   // Available icons from the icons folder
   const availableIcons = [
     'alert',
     'command_post', 
     'friendly_aircraft',
     'ground_unit',
     'hostile_aircraft',
     'mother-aircraft',
     'naval_unit',
     'neutral_aircraft',
     'sam_site',
     'unknown_aircraft'
   ];

   const getAvailableIcons = () => availableIcons;

   const setNodeIcon = (nodeId: string, iconName: string) => {
     if (iconName === '') {
       // Remove the mapping to use default icon
       setNodeIconMappings(prev => {
         const newMappings = { ...prev };
         delete newMappings[nodeId];
         return newMappings;
       });
     } else {
       setNodeIconMappings(prev => ({
         ...prev,
         [nodeId]: iconName
       }));
     }
   };

   const getNodeIcon = (node: Node, allNodes: Node[] = []) => {
    // Check for custom icon mapping first
    const nodeId = node.userId.toString();
    if (nodeIconMappings[nodeId]) {
      const iconName = nodeIconMappings[nodeId];
      console.log(`Using custom icon: ${iconName}.svg for node ${node.userId}`);
      return {
        url: `/icons/${iconName}.svg`,
        width: 32,
        height: 32,
        anchorY: 16,
        anchorX: 16,
        mask: false
      };
    }

    // Fallback to automatic icon selection based on node properties
    let iconName = 'neutral_aircraft'; // default fallback
    
    // Find the mother aircraft using the same deterministic logic as the map component
    const getMotherAircraft = () => {
      if (allNodes.length === 0) return null;
      
      const sortedNodes = allNodes
        .filter(n => n.snr !== undefined && n.snr !== null)
        .sort((a, b) => {
          // Primary sort: SNR (highest first)
          if (b.snr !== a.snr) {
            return b.snr - a.snr;
          }
          // Secondary sort: userId (lowest first) for deterministic tie-breaking
          return a.userId - b.userId;
        });
      
      return sortedNodes.length > 0 ? sortedNodes[0] : null;
    };
    
    const motherAircraft = getMotherAircraft();
    
    // Special case: Show mother-aircraft.svg for the single mother aircraft
    if (motherAircraft && node.userId === motherAircraft.userId) {
      iconName = 'mother-aircraft';
    } else if (node.hopCount === 0) {
      // Root/gateway node
      iconName = 'command_post';
    } else if (node.snr > 20) {
      // Strong signal node
      iconName = 'friendly_aircraft';
    } else if (node.snr > 10) {
      // Medium signal node
      iconName = 'ground_unit';
    } else if (node.snr > 0) {
      // Weak signal node
      iconName = 'neutral_aircraft';
    } else {
      // Unknown/no signal
      iconName = 'unknown_aircraft';
    }

    console.log(`Using auto-selected icon: ${iconName}.svg for node ${node.userId}`);
    
    return {
      url: `/icons/${iconName}.svg`,
      width: 32,
      height: 32,
      anchorY: 16, // Center the icon vertically
      anchorX: 16, // Center the icon horizontally
      mask: false
    };
   }

   const getSignalColor = (snr: number, rssi: number): [number, number, number] => {
    // Use SNR as primary indicator, RSSI as secondary
    // SNR: Higher is better (typically 0-30 dB)
    // RSSI: Higher is better (typically -100 to -30 dBm)
    
    // Normalize SNR to 0-1 scale (assuming 0-30 dB range)
    const normalizedSNR = Math.max(0, Math.min(1, snr / 30));
    
    // Normalize RSSI to 0-1 scale (assuming -100 to -30 dBm range)
    const normalizedRSSI = Math.max(0, Math.min(1, (rssi + 100) / 70));
    
    // Combine both metrics (70% SNR, 30% RSSI)
    const signalStrength = (normalizedSNR * 0.7) + (normalizedRSSI * 0.3);
    
    // Greyish color mapping: Dark Grey (weak) -> Medium Grey (medium) -> Light Grey (strong)
    if (signalStrength >= 0.7) {
      // Strong signal - Light Grey
      return [200, 200, 200]; // Light grey
    } else if (signalStrength >= 0.4) {
      // Medium signal - Medium Grey
      return [150, 150, 150]; // Medium grey
    } else {
      // Weak signal - Dark Grey
      return [100, 100, 100]; // Dark grey
    }
   }

   const createConnectionsLayer = (connectionLines: [[number, number], [number, number]][], nodes: Node[], layerName?: string): LayerProps[] => {
    // Create individual line layers for each connection with signal-based colors
    const connectionLayers: LayerProps[] = connectionLines.map((line, index) => {
      // Find the source and target nodes for this connection 
      const sourceNode = nodes.find(n => 
        Math.abs(n.longitude - line[0][0]) < 0.0001 && 
        Math.abs(n.latitude - line[0][1]) < 0.0001
      );
      const targetNode = nodes.find(n => 
        Math.abs(n.longitude - line[1][0]) < 0.0001 && 
        Math.abs(n.latitude - line[1][1]) < 0.0001
      );

      // Calculate average signal strength between the two nodes
      let signalColor: [number, number, number] = [128, 128, 128]; // Default grey
      
      if (sourceNode && targetNode) {
        const avgSNR = (sourceNode.snr + targetNode.snr) / 2;
        const avgRSSI = (sourceNode.rssi + targetNode.rssi) / 2;
        signalColor = getSignalColor(avgSNR, avgRSSI);
        
      }

      return {
        type: "line",
        id: generateLayerId(),
        name: `${layerName || 'Nodes'} Connection ${index + 1}`,
        path: [line[0], line[1]],
        color: signalColor,
        lineWidth: 5,
        visible: true,
      };
    });

    return connectionLayers;
   }

   const addConnectionsToLayers = (nodes: Node[], newLayers: LayerProps[], layerName?: string) => {
    // Create a map of userId to node for quick lookup
    const nodeMap = new Map<number, Node>();
    nodes.forEach(node => {
      nodeMap.set(node.userId, node);
    });

    // Create connection lines between connected nodes
    const connectionLines: [[number, number], [number, number]][] = [];
    const processedConnections = new Set<string>();
    
    
    nodes.forEach(sourceNode => {
      
      if (sourceNode.connectedNodeIds && Array.isArray(sourceNode.connectedNodeIds)) {
        sourceNode.connectedNodeIds.forEach(targetUserId => {
          const targetNode = nodeMap.get(targetUserId);
          
          if (targetNode) {
            // Create a unique connection identifier to avoid duplicates
            const connectionId = [sourceNode.userId, targetUserId].sort().join('-');
            if (!processedConnections.has(connectionId)) {
              processedConnections.add(connectionId);
              const connectionLine: [[number, number], [number, number]] = [
                [sourceNode.longitude, sourceNode.latitude],
                [targetNode.longitude, targetNode.latitude]
              ];
              connectionLines.push(connectionLine);
            }
          }
        });
      }
    });

    // FORCE TEST CONNECTIONS - Always create them for debugging
    if (nodes.length >= 2) {
      for (let i = 0; i < Math.min(nodes.length - 1, 3); i++) {
        const testConnection: [[number, number], [number, number]] = [
          [nodes[i].longitude, nodes[i].latitude],
          [nodes[i + 1].longitude, nodes[i + 1].latitude]
        ];
        connectionLines.push(testConnection);
      }
    }

    // Create connections layers if there are connections
    if (connectionLines.length > 0) {
      const connectionsLayers = createConnectionsLayer(connectionLines, nodes, layerName);
      newLayers.push(...connectionsLayers);
    }
   }
    
      const handleClick = (event: any) => {
        console.log("handleClick called with:", { event, drawingMode, lngLat: event.lngLat });
        
        if (!event.lngLat || !drawingMode) {
          console.log("handleClick early return:", { hasLngLat: !!event.lngLat, drawingMode });
          return;
        }
        
        const { lng: longitude, lat: latitude } = event.lngLat;
        const clickPoint: [number, number] = [longitude, latitude];

        console.log("Click point:", clickPoint, "Drawing mode:", drawingMode);
    
        switch (drawingMode) {
          case "point":
            console.log("Creating point layer at:", clickPoint);
            createPointLayer(clickPoint);
            break;
          case "line":
            handleLineDrawing(clickPoint);
            break;
          case "polygon":
            handlePolygonDrawing(clickPoint);
            break;
        }
      };
    
      const createPointLayer = (position: [number, number]) => {
        console.log("createPointLayer called with position:", position);
        const newLayer: LayerProps = {
          type: "point",
          id: generateLayerId(),
          name: `Point ${layers.filter((l) => l.type === "point").length + 1}`,
          position,
          color: [255, 0, 0],
          radius: 50000,
          visible: true,
        };
        console.log("Creating new point layer:", newLayer);
        console.log("Current layers count:", layers.length);
        setLayers([...layers, newLayer]);
        console.log("Point layer added, new layers count:", layers.length + 1);
      };


      const createGeoJsonLayer = (geojson: GeoJSON.FeatureCollection, fileName: string) => {

        
        // Create a single layer that contains all the GeoJSON features
        const newLayer: LayerProps = {
          type: "geojson",
          id: generateLayerId(),
          name: fileName ? fileName.split('.')[0] : `GeoJSON Layer ${layers.filter((l) => l.type === "geojson").length + 1}`,
          geojson: geojson,
          color: [Math.floor(Math.random() * 255), Math.floor(Math.random() * 255), Math.floor(Math.random() * 255)],
          pointRadius: 50000, // Default radius for point features
          visible: true,
        };
        
       
        setLayers([...layers, newLayer]);
      };

      const createNodeLayer = useCallback((nodes: Node[], layerName?: string) => {
        console.log('createNodeLayer called with:', { nodes, layerName, nodeCount: nodes?.length });
        
        if (!nodes || !Array.isArray(nodes) || nodes.length === 0) {
          console.warn('createNodeLayer: Invalid or empty nodes array');
          return;
        }
        
        // Validate node structure
        const validNodes = nodes.filter(node => {
          const isValid = node && 
            typeof node.latitude === 'number' && 
            typeof node.longitude === 'number' &&
            typeof node.userId === 'number';
          
          if (!isValid) {
            console.warn('createNodeLayer: Invalid node structure:', node);
          }
          return isValid;
        });
        
        console.log('createNodeLayer: Valid nodes:', validNodes.length, 'out of', nodes.length);
        
        if (validNodes.length === 0) {
          console.warn('createNodeLayer: No valid nodes to create layer');
          return;
        }
        
        // Remove existing node layers and connection layers first to prevent duplicates
        setLayers(currentLayers => {
          console.log('createNodeLayer: Current layers count:', currentLayers.length);
          
          const otherLayers = currentLayers.filter(layer => 
            layer.type !== "nodes" && 
            !layer.name?.includes("Connections") && 
            !layer.name?.includes("Connection:")  && 
            !layer.name?.includes("Connection ")
          );
          
          console.log('createNodeLayer: Other layers count:', otherLayers.length);
          
          // Convert nodes to GeoJSON FeatureCollection
          const nodeFeatures: GeoJSON.Feature[] = validNodes.map((node, index) => ({
            type: "Feature",
            geometry: {
              type: "Point",
              coordinates: [node.longitude, node.latitude]
            },
            properties: {
              ...node,
              id: index,
            }
          }));

          const nodeGeojson: GeoJSON.FeatureCollection = {
            type: "FeatureCollection",
            features: nodeFeatures
          };

          console.log('createNodeLayer: Created GeoJSON with', nodeFeatures.length, 'features');

          // Create the layers to return
          const newLayers: LayerProps[] = [];

          // Create the nodes layer
          const nodesLayer: LayerProps = {
            type: "nodes",
            id: generateLayerId(),
            name: layerName || `Nodes Layer ${currentLayers.filter((l) => l.type === "nodes").length + 1}`,
            geojson: nodeGeojson,
            nodes: validNodes,
            color: [0, 150, 255], // Blue color for nodes
            pointRadius: 30000, // Default radius for node features
            visible: true,
          };
          newLayers.push(nodesLayer);
          
          console.log('createNodeLayer: Created nodes layer:', nodesLayer);

          // Add connections using the dedicated function
          addConnectionsToLayers(validNodes, newLayers, layerName);
          
          const finalLayers = [...otherLayers, ...newLayers];
          console.log('createNodeLayer: Final layers count:', finalLayers.length);
          
          return finalLayers;
        });
      }, []);
    
      const handleLineDrawing = (point: [number, number]) => {
        if (!isDrawing) {
          setCurrentPath([point]);
          setIsDrawing(true);
        } else {
          const finalPath = [currentPath[0], point];
          const newLayer: LayerProps = {
            type: "line",
            id: generateLayerId(),
            name: `Line ${layers.filter((l) => l.type === "line").length + 1}`,
            path: finalPath,
            color: [96, 96, 96], // Dark grey for regular lines
            lineWidth: 5,
            visible: true,
          };
          setLayers([...layers, newLayer]);
          setCurrentPath([]);
          setIsDrawing(false);
        }
      };

      const handleLayerVisibility = (layerId: string, visible: boolean) => {
        setLayers(layers.map((l) => l.id === layerId ? { ...l, visible } : l));
      };

      const toggleNetworkLayersVisibility = () => {
        setNetworkLayersVisible(!networkLayersVisible);
      };
      const handleLayerName = (layerId: string, name: string) => {
        setLayers(layers.map((l) => l.id === layerId ? { ...l, name } : l));
      };
      const handleLayerColor = (layerId: string, color: [number, number, number]) => {
        setLayers(layers.map((l) => l.id === layerId ? { ...l, color } : l));
      };
      
      const handleLayerPointRadius = (layerId: string, pointRadius: number) => {
        setLayers(layers.map((l) => l.id === layerId ? { ...l, pointRadius } : l));
      };
      const handleLayerRadius = (layerId: string, radius: number) => {
        setLayers(layers.map((l) => l.id === layerId ? { ...l, radius } : l));
      };

      const clearAllLayers = () => {
        setLayers([]);
      //  console.log('All layers cleared');
      };

      // Download all layers including network layers to JSON file
      const downloadAllLayers = async () => {
        try {
          // Get current timestamp for filename
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          const filename = `layers_export_${timestamp}.json`;
          
          // Prepare the export data with all layers (including connection layers)
          const exportData = {
            version: "1.0",
            exportDate: new Date().toISOString(),
            totalLayers: layers.length,
            layers: layers, // This includes ALL layers including network and connection layers
            nodeIconMappings: nodeIconMappings, // Include icon mappings
          };
          
          // Convert to JSON string with pretty formatting
          const jsonContent = JSON.stringify(exportData, null, 2);
          
          // Save file using Capacitor Filesystem
          const result = await Filesystem.writeFile({
            path: `HSC_Layers/${filename}`,
            data: jsonContent,
            directory: Directory.Documents,
            encoding: Encoding.UTF8,
            recursive: true, // Create folder if it doesn't exist
          });
          
          console.log('File saved successfully at:', result.uri);
          showMessage(`Successfully downloaded ${layers.length} layers to ${filename}`);
          
          return result.uri;
        } catch (error) {
          console.error('Error downloading layers:', error);
          showMessage(`Error downloading layers: ${error instanceof Error ? error.message : 'Unknown error'}`, true);
          throw error;
        }
      };

      // New functions for managing stored upload/download data
      const getStoredUploadData = async (fileName: string) => {
        try {
          const data = await getUploadData(fileName);
          return data ? JSON.parse(data) : null;
        } catch (error) {
          console.error('Error retrieving upload data:', error);
          return null;
        }
      };

      const getStoredDownloadData = async (fileName: string) => {
        try {
          const data = await getDownloadData(fileName);
          return data ? JSON.parse(data) : null;
        } catch (error) {
          console.error('Error retrieving download data:', error);
          return null;
        }
      };

      const clearStoredUploadData = async (fileName: string) => {
        try {
          await removeUploadData(fileName);
          showMessage(`Cleared stored upload data for: ${fileName}`);
        } catch (error) {
          console.error('Error clearing upload data:', error);
          showMessage(`Error clearing upload data: ${error instanceof Error ? error.message : 'Unknown error'}`, true);
        }
      };

      const clearStoredDownloadData = async (fileName: string) => {
        try {
          await removeDownloadData(fileName);
          showMessage(`Cleared stored download data for: ${fileName}`);
        } catch (error) {
          console.error('Error clearing download data:', error);
          showMessage(`Error clearing download data: ${error instanceof Error ? error.message : 'Unknown error'}`, true);
        }
      };

      const loadStoredUploadData = async (fileName: string) => {
        try {
          const uploadData = await getStoredUploadData(fileName);
          if (uploadData && uploadData.layerData) {
            createGeoJsonLayer(uploadData.layerData, uploadData.fileName);
            showMessage(`Loaded stored upload data: ${fileName}`);
            return true;
          } else {
            showMessage(`No stored upload data found for: ${fileName}`, true);
            return false;
          }
        } catch (error) {
          console.error('Error loading stored upload data:', error);
          showMessage(`Error loading stored upload data: ${error instanceof Error ? error.message : 'Unknown error'}`, true);
          return false;
        }
      };

      const loadStoredDownloadData = async (fileName: string) => {
        try {
          const downloadData = await getStoredDownloadData(fileName);
          if (downloadData && downloadData.layerData && downloadData.layerData.layers) {
            setLayers(downloadData.layerData.layers);
            showMessage(`Loaded stored download data: ${fileName} (${downloadData.totalLayers} layers)`);
            return true;
          } else {
            showMessage(`No stored download data found for: ${fileName}`, true);
            return false;
          }
        } catch (error) {
          console.error('Error loading stored download data:', error);
          showMessage(`Error loading stored download data: ${error instanceof Error ? error.message : 'Unknown error'}`, true);
          return false;
        }
      };

      // New Filesystem-based functions
      const listStoredFiles = async () => {
        try {
          const files = await listFilesInDirectory();
          const layerFiles = files.filter(file => 
            file.name.startsWith('upload_') || file.name.startsWith('download_')
          );
          return layerFiles;
        } catch (error) {
          console.error('Error listing stored files:', error);
          showMessage(`Error listing files: ${error instanceof Error ? error.message : 'Unknown error'}`, true);
          return [];
        }
      };

      const loadFileFromFilesystem = async (fileName: string) => {
        try {
          const content = await readFileFromFilesystem(fileName);
          const data = JSON.parse(content as string);
          
          if (fileName.startsWith('upload_') && data.layerData) {
            // Load upload data
            createGeoJsonLayer(data.layerData, data.fileName);
            showMessage(`Loaded file from filesystem: ${data.fileName}`);
            return true;
          } else if (fileName.startsWith('download_') && data.layerData && data.layerData.layers) {
            // Load download data
            setLayers(data.layerData.layers);
            showMessage(`Loaded layers from filesystem: ${data.fileName} (${data.totalLayers} layers)`);
            return true;
          } else {
            showMessage(`Invalid file format: ${fileName}`, true);
            return false;
          }
        } catch (error) {
          console.error('Error loading file from filesystem:', error);
          showMessage(`Error loading file: ${error instanceof Error ? error.message : 'Unknown error'}`, true);
          return false;
        }
      };

      const deleteStoredFile = async (fileName: string) => {
        try {
          await deleteFileFromFilesystem(fileName);
          showMessage(`Deleted file: ${fileName}`);
        } catch (error) {
          console.error('Error deleting file:', error);
          showMessage(`Error deleting file: ${error instanceof Error ? error.message : 'Unknown error'}`, true);
        }
      };

      const getFileInfoFromFilesystem = async (fileName: string) => {
        try {
          const info = await getFileInfo(fileName);
          return info;
        } catch (error) {
          console.error('Error getting file info:', error);
          return null;
        }
      };

      const deleteLayer = (layerId: string) => {
        console.log('Deleting layer with ID:', layerId);
        setLayers(prevLayers => {
          const filteredLayers = prevLayers.filter(layer => layer.id !== layerId);
          console.log('Layers before deletion:', prevLayers.length);
          console.log('Layers after deletion:', filteredLayers.length);
          return filteredLayers;
        });
      };

    
      const isPointNearFirstPoint = (
        point: [number, number],
        firstPoint: [number, number],
        threshold = 0.1
      ) => {
        const distance = Math.sqrt(
          Math.pow(point[0] - firstPoint[0], 2) +
            Math.pow(point[1] - firstPoint[1], 2)
        );
        return distance < threshold;
      };
    
      const handlePolygonDrawing = (point: [number, number]) => {
        if (!isDrawing) {
          setCurrentPath([point]);
          setIsDrawing(true);
        } else {
          if (
            currentPath.length >= 3 &&
            isPointNearFirstPoint(point, currentPath[0])
          ) {
            const closedPath = [...currentPath, currentPath[0]];
            const newLayer: LayerProps = {
              type: "polygon",
                id: generateLayerId(),
              name: `Polygon ${
                layers.filter((l) => l.type === "polygon").length + 1
              }`,
              polygon: [closedPath],
              color: [96, 96, 96], // Dark grey for regular polygons
              visible: true,
            };
            setLayers([...layers, newLayer]);
            setCurrentPath([]);
            setIsDrawing(false);
          } else {
            setCurrentPath((prev) => [...prev, point]);
          }
        }
      };
    
      const handleMouseMove = (event: any) => {
        if (!event.lngLat) return;
    
        const { lng: longitude, lat: latitude } = event.lngLat;
        const currentPoint: [number, number] = [longitude, latitude];
        setMousePosition(currentPoint);
      };


      const handleVoiceCall = (node: Node) => {
        console.log('Starting voice call with node:', node.userId);
        // TODO: Implement voice call functionality
        alert(`Voice call with Node ${node.userId} - Feature coming soon!`);
      };

      const handleVideoCall = (node: Node) => {
        console.log('Starting video call with node:', node.userId);
        // TODO: Implement video call functionality
        alert(`Video call with Node ${node.userId} - Feature coming soon!`);
      };

      const handleSendMessage = (node: Node) => {
        console.log('Sending message to node:', node.userId);
        // TODO: Implement message sending functionality
        alert(`Send message to Node ${node.userId} - Feature coming soon!`);
      };

      const closeNodeDialog = () => {
        setIsNodeDialogOpen(false);
        setSelectedNode(null);
      };

      const toggleDrawingMode = (mode: "point" | "polygon" | "line" | null) => {
        console.log("toggleDrawingMode called with mode:", mode, "current drawingMode:", drawingMode);
        // If clicking the same mode, turn it off (set to null)
        if (drawingMode === mode) {
          console.log("Turning off drawing mode");
          setDrawingMode(null);
          setIsDrawing(false);
          setCurrentPath([]);
          setDragStart(null);
        } else {
          console.log("Setting drawing mode to:", mode);
          setDrawingMode(mode);
          // Reset drawing state when switching modes
          setIsDrawing(false);
          setCurrentPath([]);
          setDragStart(null);
        }
      };
    
      const handleMouseUp = () => {
        if (!isDrawing || !dragStart) return;
    
        setIsDrawing(false);
        setDragStart(null);
      };
    
      // Helper function to check if a layer should be visible based on network toggle
      const isLayerVisible = (layer: LayerProps) => {
        if (!layer.visible) return false;
        
        // Check if this is a network-related layer (nodes or connections)
        const isNetworkLayer = layer.name?.includes("Network") || 
                              layer.name?.includes("Connection") || 
                              layer.type === "nodes";
        
        // If it's a network layer and network layers are disabled, hide it
        if (isNetworkLayer && !networkLayersVisible) {
          return false;
        }
        
        return true;
      };

      const pointLayers = layers.filter((l) => l.type === "point" && isLayerVisible(l));
      const lineLayers = layers.filter((l) => l.type === "line" && isLayerVisible(l) && !l.name?.includes("Connection"));
      const connectionLayers = layers.filter((l) => l.type === "line" && isLayerVisible(l) && l.name?.includes("Connection"));
      const polygonLayers = layers.filter((l) => l.type === "polygon" && isLayerVisible(l));
      const geoJsonLayers = layers.filter((l) => l.type === "geojson" && isLayerVisible(l));
      const nodeLayers = layers.filter((l) => l.type === "nodes" && isLayerVisible(l));
    
      const previewLayers: LayerProps[] = [];
    
      if (
        isDrawing &&
        drawingMode === "line" &&
        currentPath.length === 1 &&
        mousePosition
      ) {
        previewLayers.push({
          type: "line",
          id: generateLayerId(),
          name: "Preview Line",
          path: [currentPath[0], mousePosition],
          color: [160, 160, 160], // Light grey for preview lines
          lineWidth: 3,
          visible: true,
        });
      }
    
      if (
        isDrawing &&
        drawingMode === "polygon" &&
        currentPath.length >= 1 &&
        mousePosition
      ) {
        if (currentPath.length === 1) {
          previewLayers.push({
            type: "line",
            id: generateLayerId(),
            name: "Preview Polygon Line",
            path: [currentPath[0], mousePosition],
            color: [160, 160, 160], // Light grey for polygon preview lines
            lineWidth: 2,
            visible: true,
          });
        } else if (currentPath.length >= 2) {
          // Show current polygon + line to mouse + closing line
          const previewPath = [...currentPath, mousePosition];
          previewLayers.push({
            type: "polygon",
            id: generateLayerId(),
            name: "Preview Polygon",
            polygon: [previewPath],
            color: [160, 160, 160], // Light grey for polygon preview
            visible: true,
          });
    
          // Show closing line if near first point
          if (isPointNearFirstPoint(mousePosition, currentPath[0])) {
            previewLayers.push({
              type: "line",
              id: generateLayerId(),
              name: "Preview Closing Line",
              path: [mousePosition, currentPath[0]],
              color: [255, 255, 0], // Yellow closing indicator
              lineWidth: 3,
              visible: true,
            });
          }
        }
      }
      if (isDrawing && currentPath.length > 0) {
        currentPath.forEach((point, index) => {
          previewLayers.push({
            type: "point",
            id: generateLayerId(),
            name: `Preview Point ${index + 1}`,
            position: point,
            color: index === 0 ? [255, 255, 0] : [255, 0, 255], // First point yellow, others magenta
            radius: 30000,
            visible: true,
          });
        });
      }
    
      const scatterLayer = new ScatterplotLayer({
        id: "point-layer",
        data: pointLayers,
        getPosition: (d: LayerProps) => d.position!,
        getRadius: (d: LayerProps) => d.radius || 50000,
        getFillColor: (d: LayerProps) => d.color,
        pickable: true,
        visible: true,
        onHover: (info) => setHoverInfo(info),
        onHoverEnd: () => setHoverInfo(undefined),
      });
    
      const previewPointLayers = previewLayers.filter((l) => l.type === "point");
      const previewLineLayers = previewLayers.filter((l) => l.type === "line");
      const previewPolygonLayers = previewLayers.filter(
        (l) => l.type === "polygon"
      );

      const previewPointLayer = new ScatterplotLayer({
        id: "preview-point-layer",
        data: previewPointLayers,
        getPosition: (d: LayerProps) => d.position!,
        getRadius: (d: LayerProps) => d.radius || 30000,
        getFillColor: (d: LayerProps) => d.color,
        pickable: false,
      });
    
      const pathData = lineLayers.flatMap((layer) =>
        layer.path!.slice(0, -1).map((point, index) => ({
          sourcePosition: point,
          targetPosition: layer.path![index + 1],
          color: layer.color,
          width: layer.lineWidth || 5,
          layerId: layer.id,
        }))
      );
    
      const pathLayer = new LineLayer({
        id: "path-layer",
        data: pathData,
        getSourcePosition: (d: any) => d.sourcePosition,
        getTargetPosition: (d: any) => d.targetPosition,
        getColor: (d: any) => d.color,
        getWidth: (d: any) => d.width,
        pickable: true,
      });

      // Create connection lines layer (separate from regular lines)
      const connectionPathData = connectionLayers.flatMap((layer) =>
        layer.path!.slice(0, -1).map((point, index) => ({
          sourcePosition: point,
          targetPosition: layer.path![index + 1],
          color: layer.color,
          width: layer.lineWidth || 5,
          layerId: layer.id,
        }))
      );
    
      const connectionPathLayer = new LineLayer({
        id: "connection-path-layer",
        data: connectionPathData,
        getSourcePosition: (d: any) => d.sourcePosition,
        getTargetPosition: (d: any) => d.targetPosition,
        getColor: (d: any) => d.color,
        getWidth: (d: any) => d.width,
        pickable: true,
      });
    
      const previewPathData = previewLineLayers.flatMap((layer) =>
        layer.path!.slice(0, -1).map((point, index) => ({
          sourcePosition: point,
          targetPosition: layer.path![index + 1],
          color: layer.color,
          width: layer.lineWidth || 3,
          layerId: layer.id,
        }))
      );
    
      const previewPathLayer = new LineLayer({
        id: "preview-path-layer",
        data: previewPathData,
        getSourcePosition: (d: any) => d.sourcePosition,
        getTargetPosition: (d: any) => d.targetPosition,
        getColor: (d: any) => d.color,
        getWidth: (d: any) => d.width,
        pickable: false,
        onHover: (info) => setHoverInfo(info),
        onHoverEnd: () => setHoverInfo(undefined),
      });
    
      const previewPolygonLayer = new PolygonLayer({
        id: "preview-polygon-layer",
        data: previewPolygonLayers,
        getPolygon: (d: LayerProps) => d.polygon![0],
        getFillColor: (d: LayerProps) =>
          d.color.length === 4
            ? d.color
            : ([...d.color, 50] as [number, number, number, number]),
        getLineColor: (d: LayerProps) =>
          d.color.slice(0, 3) as [number, number, number],
        getLineWidth: 2,
        pickable: false,
        onHover: (info) => setHoverInfo(info),
        onHoverEnd: () => setHoverInfo(undefined),
      });
    
      const polygonLayer = new PolygonLayer({
        id: "polygon-layer",
        data: polygonLayers,
        getPolygon: (d: LayerProps) => d.polygon![0],
        getFillColor: (d: LayerProps) =>
          d.color.length === 4
            ? d.color
            : ([...d.color, 100] as [number, number, number, number]),
        getLineColor: (d: LayerProps) =>
          d.color.slice(0, 3) as [number, number, number],
        getLineWidth: 2,
        pickable: true,
        onHover: (info) => setHoverInfo(info),
        onHoverEnd: () => setHoverInfo(undefined),
      });

     
      
      const geoLayers = geoJsonLayers.map((layer) => {
        
        return new GeoJsonLayer({
          id: layer.id,
          data: layer.geojson,
          pickable: true,
          stroked: true,
          filled: true,
          getFillColor: (f: any) => {
            // Use feature color if available, otherwise use layer color with alpha
            if (f.properties?.color) {
              return f.properties.color;
            }
            // Convert RGB to RGBA by adding alpha channel
            const [r, g, b] = layer.color;
            return [r, g, b, 120];
          },
          getLineColor: (f: any) => {
            // Use feature line color if available, otherwise use layer color
            if (f.properties?.lineColor) {
              return f.properties.lineColor;
            }
            const [r, g, b] = layer.color;
            return [r, g, b, 255];
          },
          getPointRadius: (f: any) => {
            // Only apply pointRadius to Point geometries
            if (f.geometry?.type === 'Point') {
              return layer.pointRadius || 50000;
            }
            return 0; // Not a point, so no radius
          },
          getLineWidth: (f: any) => {
            // Make connection lines thicker and more visible
            if (f.geometry?.type === 'LineString') {
              return 5;
            }
            return 2;
          },
          // Add update triggers to force re-render when layer properties change
          updateTriggers: {
            getFillColor: [layer.color],
            getLineColor: [layer.color],
            getPointRadius: [layer.pointRadius],
            getLineWidth: [layer.color], // Add line width trigger for connections
          },
          onHover: (info) => setHoverInfo(info),
          onHoverEnd: () => setHoverInfo(undefined),
        });
      });

      // Create node layers using IconLayer (prioritize icons over circles)
      const nodeIconLayers = nodeLayers.flatMap((layer) => {
        console.log('Processing node layer:', layer.id, 'with', layer.nodes?.length, 'nodes');
        
        if (!layer.nodes || layer.nodes.length === 0) {
          console.warn('Node layer has no nodes:', layer.id);
          return [];
        }
        
        const layerInstances = [];
        
        // Add IconLayer with SVG icons from /icons/ folder
        try {
          console.log('Creating IconLayer for layer:', layer.id);
          
          // Pre-load icon URLs to ensure they're available
          const iconUrls = [...new Set(layer.nodes.map(node => getNodeIcon(node, layer.nodes).url))];
          console.log('Icon URLs to load:', iconUrls);
          
          layerInstances.push(new IconLayer({
            id: layer.id,
            data: [...layer.nodes], // Create a copy to avoid reference issues
            pickable: true,
            getIcon: (node: Node) => {
              const iconConfig = getNodeIcon(node, layer.nodes);
              console.log(`Loading icon for node ${node.userId}:`, iconConfig.url);
              return iconConfig;
            },
            getPosition: (node: Node) => [node.longitude, node.latitude],
            getSize: 32, // Larger icon size for better visibility
            sizeScale: 1,
            getPixelOffset: [0, 0],
            alphaCutoff: 0.01, // Lower cutoff for better icon visibility
            billboard: true,
            sizeUnits: 'pixels',
            updateTriggers: {
              getIcon: [layer.nodes?.length, layer.nodes?.map(n => n.userId).join('-'), Object.keys(nodeIconMappings).join('-')],
              getPosition: [layer.nodes?.length],
              getSize: [layer.nodes?.length],
            },
            onHover: (info) => {
              console.log('Node hovered:', info.object);
              setHoverInfo(info);
            },
            onHoverEnd: () => setHoverInfo(undefined),
            onClick: (info) => {
              if (info.object) {
                const node = info.object as Node;
                // Only show dialog for socket nodes (nodes with network properties)
                const isSocketNode = node.hasOwnProperty('snr') && 
                                   node.hasOwnProperty('rssi') && 
                                   node.hasOwnProperty('userId') && 
                                   node.hasOwnProperty('hopCount');
                
                if (isSocketNode) {
                  console.log('Socket node clicked:', node);
                  // Trigger node click dialog by dispatching a custom event
                  const event = new CustomEvent('nodeIconSelection', {
                    detail: { 
                      nodeId: node.userId.toString(),
                      nodeData: node
                    }
                  });
                  window.dispatchEvent(event);
                } else {
                  console.log('Manual node clicked - no dialog shown');
                }
              }
            },
          }));
          console.log('Successfully created IconLayer for layer:', layer.id);
        } catch (error) {
          console.warn('Failed to create IconLayer:', error);
          
          // Only add fallback circles if IconLayer fails
          try {
            console.log('Creating fallback ScatterplotLayer for layer:', layer.id);
            layerInstances.push(new ScatterplotLayer({
              id: `${layer.id}-fallback`,
              data: [...layer.nodes],
              pickable: true,
              getPosition: (node: Node) => [node.longitude, node.latitude],
              getRadius: 8000, // Smaller fallback circles
              getFillColor: (node: Node) => getSignalColor(node.snr, node.rssi),
              getLineColor: [255, 255, 255, 200],
              getLineWidth: 1,
              onHover: (info) => setHoverInfo(info),
              onHoverEnd: () => setHoverInfo(undefined),
            }));
            console.log('Successfully created fallback ScatterplotLayer for layer:', layer.id);
          } catch (fallbackError) {
            console.warn('Failed to create fallback ScatterplotLayer:', fallbackError);
          }
        }
        
        console.log('Created', layerInstances.length, 'layer instances for node layer:', layer.id);
        return layerInstances;
      });

      
  
      // Combine all layers safely
      const allLayers = [
        scatterLayer,
        pathLayer,
        connectionPathLayer,
        polygonLayer,
        previewPointLayer,
        previewPathLayer,
        previewPolygonLayer,
        ...geoLayers,
        ...nodeIconLayers,
      ].filter(Boolean) // Remove any null/undefined layers

    // Filter out connection layers from the layers array for sidebar display
    const sidebarLayers = layers.filter(layer => !layer.name?.includes("Connection"));

    return {
        allLayers,
        layers: sidebarLayers, // Only show non-connection layers in sidebar
        handleClick,
        handleMouseMove,
        handleMouseUp,
        handleLayerVisibility,
        toggleDrawingMode,
        drawingMode,
        handleLayerName,
        handleLayerColor,
        handleLayerRadius,
        handleLayerPointRadius,
        clearAllLayers,
        downloadAllLayers,
        deleteLayer,
        hoverInfo,
        createNodeLayer,
        selectedNode,
        isNodeDialogOpen,
        handleVoiceCall,
        handleVideoCall,
        handleSendMessage,
        closeNodeDialog,
        networkLayersVisible,
        toggleNetworkLayersVisibility,
        // Icon selection functionality
        nodeIconMappings,
        setNodeIcon,
        getAvailableIcons,
        // New Capacitor Preferences functions
        getStoredUploadData,
        getStoredDownloadData,
        clearStoredUploadData,
        clearStoredDownloadData,
        loadStoredUploadData,
        loadStoredDownloadData,
        // New Filesystem functions
        listStoredFiles,
        loadFileFromFilesystem,
        deleteStoredFile,
        getFileInfoFromFilesystem,
    }
}