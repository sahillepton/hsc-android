import type { LayerProps, Node } from "@/lib/definitions";
import { useState, useCallback, useEffect } from "react";
import { ScatterplotLayer, PolygonLayer, LineLayer, GeoJsonLayer, IconLayer } from "@deck.gl/layers";
import { showMessage, getUploadData, removeUploadData, getDownloadData, removeDownloadData, readFileFromFilesystem, deleteFileFromFilesystem, listFilesInDirectory, getFileInfo, getStorageDirectory, setStorageDirectory as setStorageDirectoryUtil, getStorageDirectoryName, getStorageDirectoryPath } from "@/lib/capacitor-utils";
import  type {PickingInfo} from '@deck.gl/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { fileToGeoJSON, fileToDEMRaster } from "@/lib/utils";

export const useLayers = () => {
    const [layers, setLayers] = useState<LayerProps[]>([]);
    const [isDrawing, setIsDrawing] = useState(false);
    const [currentPath, setCurrentPath] = useState<[number, number][]>([]);
    const [dragStart, setDragStart] = useState<[number, number] | null>(null);
    const [drawingMode, setDrawingMode] = useState<"point" | "polygon" | "line" | "azimuthal" | null>(
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

  // Helper: convert base64 string to File for reuse of existing upload logic
  // TODO: not using any state, so should be in a utils folder or the module scope
  const base64ToFile = (base64Data: string, fileName: string, mimeType: string): File => {
    const byteString = atob(base64Data);
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) {
      ia[i] = byteString.charCodeAt(i);
    }
    const blob = new Blob([ab], { type: mimeType });
    return new File([blob], fileName, { type: mimeType });
  };

    // Handle Escape key to exit drawing mode
    // TODO: Add a component called KeyboardShortcuts that has all these effects and takes to the store
    // It can return null since it doesn't have any UI
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

    // useKeyboardShortcut('Escape', (event) => {
    //   if (drawingMode) {
    //     setDrawingMode(null);
    //     setIsDrawing(false);
    //     setCurrentPath([]);
    //     setDragStart(null);
    //   }
    // })

    // TODO: again a util, keep it outside
   const generateLayerId = () => {
    return `layer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
   }

   // TODO: constant list, keep it outside
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

   // TODO: why is this needed? There is a fixed list, consumers can just use that
   const getAvailableIcons = () => availableIcons;

   // TODO: There should be one nodes list maintained in the store, the nodes list should have each node
   // Each node should have its id, icon, category, position, etc.
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

   // TODO: Rethink why you need both node and allNodes, and this again seems not depend on state,
   // take it outside or useCallback for sure, 
   // Make things efficient and performant by default
   // TODO: test react-compiler
   const getNodeIcon = (node: Node, allNodes: Node[] = []) => {
    // Check for custom icon mapping first
    const nodeId = node.userId.toString();
    if (nodeIconMappings[nodeId]) {
      const iconName = nodeIconMappings[nodeId];
      console.log(`Using custom icon: ${iconName}.svg for node ${node.userId}`);
      // Special handling for rectangular icons to prevent cutting
      const isRectangularIcon = ['ground_unit', 'command_post', 'naval_unit'].includes(iconName);
      
      return {
        url: `/icons/${iconName}.svg`,
        width: isRectangularIcon ? 28 : 24, // Smaller width for rectangular icons
        height: isRectangularIcon ? 20 : 24, // Smaller height for rectangular icons
        anchorY: isRectangularIcon ? 10 : 12, // Adjust anchor for rectangular icons
        anchorX: isRectangularIcon ? 14 : 12, // Adjust anchor for rectangular icons
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
    
    // Special handling for rectangular icons to prevent cutting
    // TODO: this check is happeninng twice in this function, why? Wrongly organized code I feel
    const isRectangularIcon = ['ground_unit', 'command_post', 'naval_unit'].includes(iconName);
    
    return {
      url: `/icons/${iconName}.svg`,
      width: isRectangularIcon ? 28 : 24, // Smaller width for rectangular icons
      height: isRectangularIcon ? 20 : 24, // Smaller height for rectangular icons
      anchorY: isRectangularIcon ? 10 : 12, // Adjust anchor for rectangular icons
      anchorX: isRectangularIcon ? 14 : 12, // Adjust anchor for rectangular icons
      mask: false
    };
   }

   // TODO: These are utility functions, don't depend on state, take it outside
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
    
    // Color mapping: Green (strong) -> Orange (medium) -> Red (weak)
    if (signalStrength >= 0.7) {
      // Strong signal - Green
      return [0, 255, 0]; // Green
    } else if (signalStrength >= 0.4) {
      // Medium signal - Orange
      return [255, 165, 0]; // Orange
    } else {
      // Weak signal - Red
      return [255, 0, 0]; // Red
    }
   }

   // TODO: This and the below function are very confusing. No idea what they are doing. Clarify the names
   // arguments and what they return
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
    // TODO: How does this debug?
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
    
   // TODO: Add prettier, why is this not formatted? Format on Save should be enabled
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
          case "azimuthal":
            handleAzimuthalDrawing(clickPoint);
            break;
        }
      };
    
      const createPointLayer = (position: [number, number]) => {
        console.log("createPointLayer called with position:", position);
        
        // Validate coordinates are within Mumbai bounds
        // TODO: Why is this hardcoded here?
        const mumbaiBounds = {
          north: 19.3,
          south: 18.9,
          east: 73.0,
          west: 72.7
        };
        
        const [lng, lat] = position;
        const isWithinBounds = lat >= mumbaiBounds.south && 
                               lat <= mumbaiBounds.north && 
                               lng >= mumbaiBounds.west && 
                               lng <= mumbaiBounds.east;
        
        console.log("Point coordinates validation:", { lng, lat, isWithinBounds, mumbaiBounds });
        
        const newLayer: LayerProps = {
          type: "point",
          id: generateLayerId(),
          name: `Point ${layers.filter((l) => l.type === "point").length + 1}`,
          position,
          color: [255, 0, 0],
          radius: 200,
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

      const uploadGeoJsonFile = async (file: File) => {
        try {
          console.log("Uploading file:", file.name, "Size:", file.size);
          
          // Better extension detection (handle .geojson and multi-dot filenames)
          const fileName = file.name.toLowerCase();
          let ext = '';
          if (fileName.endsWith('.geojson')) {
            ext = 'geojson';
          } else {
            const parts = fileName.split('.');
            ext = parts.length > 1 ? parts[parts.length - 1] : '';
          }
          
          const supportedFormats = ["geojson", "json", "shp", "zip", "csv", "gpx", "kml", "kmz"];
          
          // Allow file if extension is supported OR if MIME type suggests it's JSON/GeoJSON
          const mimeType = file.type?.toLowerCase() || '';
          const isSupportedByExt = ext && supportedFormats.includes(ext);
          const isSupportedByMime = mimeType.includes('json') || mimeType.includes('geojson');
          
          if (!isSupportedByExt && !isSupportedByMime) {
            console.warn(`File extension .${ext} not in supported formats, but attempting to process anyway`);
          }

          // Convert file to GeoJSON
          console.log("Converting file to GeoJSON...");
          const geojson = await fileToGeoJSON(file);
          console.log("GeoJSON conversion result:", geojson);
          
          // Validate GeoJSON structure
          if (!geojson) {
            showMessage("Invalid vector file format. Could not convert to GeoJSON.", true);
            return;
          }

          if (geojson.type !== "FeatureCollection") {
            showMessage(`Invalid GeoJSON format: expected FeatureCollection, got ${geojson.type}`, true);
            return;
          }

          if (!Array.isArray(geojson.features)) {
            showMessage("Invalid GeoJSON format: features is not an array.", true);
            return;
          }

          if (geojson.features.length === 0) {
            showMessage("Vector file contains no features.", true);
            return;
          }

          console.log(`Creating layer from GeoJSON with ${geojson.features.length} features`);
          // Create layer from GeoJSON
          createGeoJsonLayer(geojson, file.name);
          showMessage(`Successfully uploaded ${geojson.features.length} feature(s) from ${file.name}`);
        } catch (error) {
          console.error("Error uploading file:", error);
          showMessage(`Error uploading file: ${error instanceof Error ? error.message : "Unknown error"}`, true);
        }
      };

      const uploadDemFile = async (file: File) => {
        try {
          console.log("Uploading DEM file:", file.name);
          const dem = await fileToDEMRaster(file);
          
          // Check if default bounds were used (India bounds)
          const isDefaultBounds = dem.bounds[0] === 68.0 && dem.bounds[1] === 6.0 && 
                                  dem.bounds[2] === 97.0 && dem.bounds[3] === 37.0;
          
          const newLayer: LayerProps = {
            type: "dem",
            id: generateLayerId(),
            name: file.name.split('.')[0],
            color: [255, 255, 255],
            visible: true,
            bounds: [[dem.bounds[0], dem.bounds[1]], [dem.bounds[2], dem.bounds[3]]],
            bitmap: dem.canvas,
          };
          setLayers([...layers, newLayer]);
          
          if (isDefaultBounds) {
            showMessage(`DEM uploaded with default bounds (may not be correctly positioned). Use a georeferenced GeoTIFF for accurate positioning.`);
          } else {
            showMessage(`Successfully uploaded DEM: ${file.name}`);
          }
        } catch (error) {
          console.error("Error uploading DEM file:", error);
          showMessage(`Error uploading DEM: ${error instanceof Error ? error.message : 'Unknown error'}`, true);
        }
      };

      // Capacitor Filesystem variants: read file and reuse uploaders
      const uploadGeoJsonFromFilesystem = async (path: string, fileName?: string) => {
        try {
          const name = fileName || path.split('/').pop() || 'data.geojson';
          const ext = (name.split('.').pop() || '').toLowerCase();
          const mime = ext === 'csv' ? 'text/csv' : (ext === 'zip' ? 'application/zip' : 'application/json');
          const res = await Filesystem.readFile({ path, directory: Directory.Documents });
          const file = base64ToFile(res.data as string, name, mime);
          await uploadGeoJsonFile(file);
        } catch (error) {
          console.error('Error uploading GeoJSON from filesystem:', error);
          showMessage(`Error uploading GeoJSON from device: ${error instanceof Error ? error.message : 'Unknown error'}`, true);
        }
      };

      const uploadDemFromFilesystem = async (path: string, fileName?: string) => {
        try {
          const name = fileName || path.split('/').pop() || 'dem.tif';
          const res = await Filesystem.readFile({ path, directory: Directory.Documents });
          const file = base64ToFile(res.data as string, name, 'image/tiff');
          await uploadDemFile(file);
        } catch (error) {
          console.error('Error uploading DEM from filesystem:', error);
          showMessage(`Error uploading DEM from device: ${error instanceof Error ? error.message : 'Unknown error'}`, true);
        }
      };

      // Import layers from JSON export file
      const importLayersFromJson = async (file: File) => {
        try {
          const text = await file.text();
          const importData = JSON.parse(text);

          // Check if this is a layer export file (has version and layers)
          if (importData.version && Array.isArray(importData.layers)) {
            // Validate the data structure
            if (!importData.layers || !Array.isArray(importData.layers)) {
              throw new Error('Invalid layers data format');
            }

            // Use setTimeout to defer state updates and avoid OpenGL rendering conflicts
            setTimeout(() => {
              // Combine state updates - set layers and icon mappings in a single render cycle
              setLayers(importData.layers);
              
              // Import node icon mappings if available
              if (importData.nodeIconMappings) {
                setNodeIconMappings(importData.nodeIconMappings);
              }
              
              // Show success message after rendering completes
              setTimeout(() => {
                showMessage(`Successfully imported ${importData.layers.length} layers from ${file.name}`);
              }, 500);
            }, 300);

            return true;
          } else {
            // Not a layer export file, treat as regular GeoJSON
            return false;
          }
        } catch (error) {
          console.error('Error importing layers from JSON:', error);
          // If parsing fails, it's not a valid JSON layer export
          return false;
        }
      };

      // Function to upload annotation layer from file
      const uploadAnnotationFile = async (file: File) => {
        try {
          console.log("Uploading annotation file:", file.name);
          
          // Convert file to GeoJSON first
          const geojson = await fileToGeoJSON(file);
          
          // Validate GeoJSON structure
          if (!geojson || geojson.type !== "FeatureCollection" || !Array.isArray(geojson.features)) {
            showMessage("Invalid annotation file format. Could not convert to GeoJSON.", true);
            return;
          }

          if (geojson.features.length === 0) {
            showMessage("Annotation file contains no features.", true);
            return;
          }

          // Extract annotations from GeoJSON features
          const annotations: Array<{
            position: [number, number];
            text: string;
            color?: [number, number, number];
            fontSize?: number;
          }> = [];

          geojson.features.forEach((feature : any) => {
            // Check if feature has text/annotation properties
            const text = feature.properties?.text || 
                        feature.properties?.label || 
                        feature.properties?.name || 
                        feature.properties?.annotation ||
                        feature.properties?.title ||
                        '';
            
            // Only process features with text and valid geometry
            if (text && feature.geometry) {
              let position: [number, number] | null = null;
              
              // Extract position based on geometry type
              if (feature.geometry.type === 'Point' && feature.geometry.coordinates) {
                position = [feature.geometry.coordinates[0], feature.geometry.coordinates[1]];
              } else if (feature.geometry.type === 'LineString' && feature.geometry.coordinates.length > 0) {
                // Use first point of line
                position = [feature.geometry.coordinates[0][0], feature.geometry.coordinates[0][1]];
              } else if (feature.geometry.type === 'Polygon' && feature.geometry.coordinates.length > 0) {
                // Use first point of first ring
                position = [feature.geometry.coordinates[0][0][0], feature.geometry.coordinates[0][0][1]];
              }

              if (position) {
                // Extract color from properties or use default
                let color: [number, number, number] | undefined;
                if (feature.properties?.color) {
                  if (Array.isArray(feature.properties.color)) {
                    color = feature.properties.color.slice(0, 3) as [number, number, number];
                  }
                }

                annotations.push({
                  position,
                  text: String(text),
                  color,
                  fontSize: feature.properties?.fontSize || feature.properties?.font_size || undefined,
                });
              }
            }
          });

          if (annotations.length === 0) {
            showMessage("No valid annotations found. Features must have text/label/name/annotation properties.", true);
            return;
          }

          // Create annotation layer
          const newLayer: LayerProps = {
            type: "annotation",
            id: generateLayerId(),
            name: file.name.split('.')[0],
            color: [0, 0, 0], // Default black text
            visible: true,
            annotations: annotations,
          };

          setLayers([...layers, newLayer]);
          showMessage(`Successfully uploaded ${annotations.length} annotation(s) from ${file.name}`);
        } catch (error) {
          console.error("Error uploading annotation file:", error);
          showMessage(`Error uploading annotation file: ${error instanceof Error ? error.message : "Unknown error"}`, true);
        }
      };

      // Function to extract and process TIFF from ZIP
      const extractTiffFromZip = async (file: File): Promise<File | null> => {
        try {
          // Dynamically import JSZip
          const JSZip = (await import('jszip')).default;
          const zip = await JSZip.loadAsync(file);
          
          // Find TIFF files in the ZIP
          const tiffFiles = Object.keys(zip.files).filter(name => {
            const lowerName = name.toLowerCase();
            return lowerName.endsWith('.tif') || lowerName.endsWith('.tiff');
          });
          
          if (tiffFiles.length === 0) {
            console.log('No TIFF files found in ZIP');
            return null;
          }
          
          // Use the first TIFF file found
          const tiffFileName = tiffFiles[0];
          console.log('Found TIFF file in ZIP:', tiffFileName);
          
          const tiffData = await zip.files[tiffFileName].async('blob');
          const tiffFile = new File([tiffData], tiffFileName, { type: 'image/tiff' });
          
          return tiffFile;
        } catch (error) {
          console.error('Error extracting TIFF from ZIP:', error);
          return null;
        }
      };

      // Function to handle file import from input
      const handleFileImport = async (file: File) => {
        try {
          if (!file) {
            return;
          }

          console.log('Importing file:', file.name, 'Type:', file.type, 'Size:', file.size);

          // Determine file type from extension (handle multiple dots in filename)
          const fileName = file.name?.toLowerCase() || '';
          let ext = '';
          
          // Handle special cases for multi-part extensions
          if (fileName.endsWith('.geojson')) {
            ext = 'geojson';
          } else if (fileName.endsWith('.tiff')) {
            ext = 'tiff';
          } else {
            // Get last extension
            const parts = fileName.split('.');
            ext = parts.length > 1 ? parts[parts.length - 1] : '';
          }
          
          console.log('Detected extension:', ext);
          
          // First, check if it's a JSON file that might be a layer export
          if (ext === 'json') {
            const isLayerExport = await importLayersFromJson(file);
            if (isLayerExport) {
              // Successfully imported as layer export
              return;
            }
            // If not a layer export, fall through to treat as vector file
          }
          
          // Check if ZIP file contains TIFF files
          if (ext === 'zip') {
            console.log('Checking if ZIP contains TIFF files...');
            const tiffFile = await extractTiffFromZip(file);
            if (tiffFile) {
              console.log('Found TIFF in ZIP, processing as DEM');
              await uploadDemFile(tiffFile);
              return;
            }
            // If no TIFF found, fall through to process as shapefile
            console.log('No TIFF in ZIP, processing as shapefile');
          }
          
          // Vector file extensions
          const vectorExtensions = ['geojson', 'json', 'shp', 'zip', 'csv', 'gpx', 'kml', 'kmz'];
          // Raster/DEM file extensions (currently only GeoTIFF is supported)
          const rasterExtensions = ['tif', 'tiff'];

          // For GeoJSON/JSON files, try to detect if they contain annotations
          // Check if file might be an annotation file (by filename or content)
          if (ext === 'geojson' || ext === 'json') {
            const isAnnotationFile = fileName.includes('annotation') || 
                                     fileName.includes('label') || 
                                     fileName.includes('text') ||
                                     fileName.includes('annot');
            
            // Try annotation processing first (for files with annotation keywords or all GeoJSON files)
            // This allows any GeoJSON with text properties to be processed as annotations
            try {
              console.log('Attempting to process as annotation file...');
              // Create a temporary file reader to check content
              const text = await file.text();
              const parsed = JSON.parse(text);
              
              // Check if it has features with text/label/name/annotation properties
              if (parsed.type === 'FeatureCollection' && Array.isArray(parsed.features)) {
                const hasTextProperties = parsed.features.some((f: any) => 
                  f.properties && (
                    f.properties.text || 
                    f.properties.label || 
                    f.properties.annotation ||
                    f.properties.title
                  )
                );
                
                if (hasTextProperties || isAnnotationFile) {
                  console.log('Features contain text properties, processing as annotation layer');
                  // Reset file position by creating a new File object
                  const fileBlob = new Blob([text], { type: file.type });
                  const newFile = new File([fileBlob], file.name, { type: file.type });
                  await uploadAnnotationFile(newFile);
                  return;
                }
              }
            } catch (error) {
              console.log('Annotation processing failed or not applicable, falling back to vector processing');
              // Fall through to vector processing
            }
          }

          if (vectorExtensions.includes(ext)) {
            // Handle as vector file
            console.log('Processing as vector file');
            await uploadGeoJsonFile(file);
          } else if (rasterExtensions.includes(ext)) {
            // Handle as DEM/raster file
            console.log('Processing as raster/DEM file');
            await uploadDemFile(file);
          } else {
            // Try to detect by MIME type as fallback
            const mimeType = file.type?.toLowerCase() || '';
            if (mimeType.includes('json') || mimeType.includes('geojson')) {
              console.log('Detected by MIME type as JSON/GeoJSON');
              await uploadGeoJsonFile(file);
            } else if (mimeType.includes('tiff') || mimeType.includes('tif')) {
              console.log('Detected by MIME type as TIFF');
              await uploadDemFile(file);
            } else {
              showMessage(
                `Unsupported file type: .${ext} (${file.type || 'unknown type'}). Supported formats:\n` +
                `Layer Export: JSON (with layers array)\n` +
                `Vector: ${vectorExtensions.filter(e => e !== 'json').join(', ')}, JSON\n` +
                `Raster/DEM: ${rasterExtensions.join(', ')}, ZIP (with TIFF)\n` +
                `Note: ZIP files are checked for TIFF files first, then processed as shapefiles if no TIFF found.`,
                true
              );
            }
          }
        } catch (error) {
          console.error('Error importing file:', error);
          showMessage(`Error importing file: ${error instanceof Error ? error.message : 'Unknown error'}`, true);
        }
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
        // Find target layer to determine if it's a polygon
        const target = layers.find(l => l.id === layerId);
        const isPolygon = target?.type === "polygon";

        setLayers(layers.map((l) => {
          if (l.id === layerId) {
            return { ...l, visible };
          }
          // If polygon visibility changes, also apply to its vertex point layers
          if (isPolygon && (l.name || "").startsWith("Polygon Point")) {
            return { ...l, visible };
          }
          return l;
        }));
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
          
          // Get configured storage directory
          const storageDir = await getStorageDirectory();
          const dirName = getStorageDirectoryName(storageDir);
          const dirPath = getStorageDirectoryPath(storageDir);
          
          // Save file using Capacitor Filesystem
          const result = await Filesystem.writeFile({
            path: `HSC_Layers/${filename}`,
            data: jsonContent,
            directory: storageDir,
            encoding: Encoding.UTF8,
            recursive: true, // Create folder if it doesn't exist
          });
          
          console.log('File saved successfully at:', result.uri);
          const fullPath = `${dirName}${dirPath}HSC_Layers/${filename}`;
          showMessage(`Successfully downloaded ${layers.length} layers to Android device:\n\n📁 Path: ${fullPath}\n\n📍 Full URI: ${result.uri}\n\n💡 Tip: Files are saved to your Android device's storage. You can access them using a file manager app.`);
          
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

      // Download layers data to device storage
      const downloadLayersToDevice = async () => {
        try {
          // Prepare the export data with all layers and node icon mappings
          const exportData = {
            version: "1.0",
            exportDate: new Date().toISOString(),
            totalLayers: layers.length,
            layers: layers, // This includes ALL layers including network and connection layers
            nodeIconMappings: nodeIconMappings, // Include icon mappings
          };
          
          // Convert to JSON string with pretty formatting
          const jsonContent = JSON.stringify(exportData, null, 2);
          
          // Get configured storage directory
          const storageDir = await getStorageDirectory();
          const dirName = getStorageDirectoryName(storageDir);
          const dirPath = getStorageDirectoryPath(storageDir);
          
          // Save file using Capacitor Filesystem - always rewrite the same file
          const result = await Filesystem.writeFile({
            path: "secrets/layers_data.json",
            data: jsonContent,
            directory: storageDir,
            encoding: Encoding.UTF8,
            recursive: true, // Create folder if it doesn't exist
          });
          
          console.log('Layers data saved successfully at:', result.uri);
          const fullPath = `${dirName}${dirPath}secrets/layers_data.json`;
          
          // Use longer delay to allow MediaScannerConnection and system processes to complete
          // This prevents OpenGL rendering conflicts
          setTimeout(() => {
            showMessage(`Successfully saved ${layers.length} layers to Android device storage:\n\n📁 Path: ${fullPath}\n\n📍 Full URI: ${result.uri}\n\n💡 Tip: Files are saved to your Android device's storage. You can access them using a file manager app.`);
          }, 500);
          
          return result.uri;
        } catch (error) {
          console.error('Error saving layers to device:', error);
          // Suppress OpenGL errors that are harmless warnings
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          if (!errorMessage.includes('swap behavior') && !errorMessage.includes('OpenGL')) {
            setTimeout(() => {
              showMessage(`Error saving layers: ${errorMessage}`, true);
            }, 500);
          }
          throw error;
        }
      };

      // Import layers data from device storage
      const importLayersFromDevice = async () => {
        try {
          // Get configured storage directory
          const storageDir = await getStorageDirectory();
          
          // Read the layers data file
          const contents = await Filesystem.readFile({
            path: "secrets/layers_data.json",
            directory: storageDir,
            encoding: Encoding.UTF8,
          });

          console.log("Importing layers data:", contents);
          
          // Parse the JSON data
          const importData = JSON.parse(contents.data as string);
          
          // Validate the data structure
          if (!importData.layers || !Array.isArray(importData.layers)) {
            throw new Error('Invalid layers data format');
          }
          
          // Use setTimeout to defer state updates and avoid OpenGL rendering conflicts
          // This allows the renderer to finish any ongoing operations before updating
          setTimeout(() => {
            // Combine state updates - set layers and icon mappings in a single render cycle
            setLayers(importData.layers);
            
            // Import node icon mappings if available
            if (importData.nodeIconMappings) {
              setNodeIconMappings(importData.nodeIconMappings);
            }
            
            // Show success message after rendering completes to avoid UI conflicts
            setTimeout(() => {
              showMessage(`Successfully imported ${importData.layers.length} layers from device storage`);
            }, 500);
          }, 300);
          
          return true;
        } catch (error) {
          console.error('Error importing layers from device:', error);
          // Suppress OpenGL errors that are harmless warnings
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          if (!errorMessage.includes('swap behavior') && !errorMessage.includes('OpenGL')) {
            setTimeout(() => {
              showMessage(`Error importing layers: ${errorMessage}`, true);
            }, 500);
          }
          return false;
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
        threshold = 0.01
      ) => {
        const distance = Math.sqrt(
          Math.pow(point[0] - firstPoint[0], 2) +
            Math.pow(point[1] - firstPoint[1], 2)
        );
        console.log("Checking if point is near first point:", {
          point,
          firstPoint,
          distance,
          threshold,
          isNear: distance < threshold
        });
        return distance < threshold;
      };
    
      const handlePolygonDrawing = (point: [number, number]) => {
        console.log("handlePolygonDrawing called with:", { point, isDrawing, currentPathLength: currentPath.length });
        
        if (!isDrawing) {
          console.log("Starting new polygon at:", point);
          setCurrentPath([point]);
          setIsDrawing(true);
          // Add persistent point marker at first click
          const pointLayer: LayerProps = {
            type: "point",
            id: generateLayerId(),
            name: `Polygon Point ${layers.filter((l) => l.type === "point").length + 1}`,
            position: point,
            color: [32, 32, 32],
            radius: 5000,
            visible: true,
          };
          setLayers([...layers, pointLayer]);
        } else {
          console.log("Adding point to polygon. Current path length:", currentPath.length);
          
          if (
            currentPath.length >= 3 &&
            isPointNearFirstPoint(point, currentPath[0])
          ) {
            console.log("Closing polygon with", currentPath.length, "points");
            const closedPath = [...currentPath, currentPath[0]];
            const newLayer: LayerProps = {
              type: "polygon",
                id: generateLayerId(),
              name: `Polygon ${
                layers.filter((l) => l.type === "polygon").length + 1
              }`,
              polygon: [closedPath],
              color: [32, 32, 32, 180], // Default to dark, higher-opacity fill
              visible: true,
            };
            console.log("Creating polygon layer:", newLayer);
            setLayers([...layers, newLayer]);
            setCurrentPath([]);
            setIsDrawing(false);
          } else {
            console.log("Adding point to current path");
            // Add persistent point marker on each subsequent click
            const pointLayer: LayerProps = {
              type: "point",
              id: generateLayerId(),
              name: `Polygon Point ${layers.filter((l) => l.type === "point").length + 1}`,
              position: point,
              color: [32, 32, 32],
              radius: 5000,
              visible: true,
            };
            setLayers([...layers, pointLayer]);
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

      // --- Azimuthal helpers & drawing ---
      const toRadians = (deg: number) => (deg * Math.PI) / 180;
      const toDegrees = (rad: number) => (rad * 180) / Math.PI;

      const calculateDistanceMeters = (a: [number, number], b: [number, number]) => {
        const R = 6371000;
        const lat1 = toRadians(a[1]);
        const lat2 = toRadians(b[1]);
        const dLat = toRadians(b[1] - a[1]);
        const dLon = toRadians(b[0] - a[0]);
        const s = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
        const c = 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
        return R * c;
      };

      const calculateBearingDegrees = (a: [number, number], b: [number, number]) => {
        const lat1 = toRadians(a[1]);
        const lat2 = toRadians(b[1]);
        const dLon = toRadians(b[0] - a[0]);
        const y = Math.sin(dLon) * Math.cos(lat2);
        const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
        const brng = Math.atan2(y, x);
        return (toDegrees(brng) + 360) % 360; // Normalize 0-360
      };

      const makeSectorPolygon = (
        center: [number, number],
        radiusMeters: number,
        bearingDeg: number,
        sectorAngleDeg: number,
        segments = 64
      ): [number, number][] => {
        const [lng, lat] = center;
        const latRad = toRadians(lat);
        const metersPerDegLat = 111320; // approx
        const metersPerDegLng = 111320 * Math.cos(latRad);
        const dLat = radiusMeters / metersPerDegLat;
        const dLng = radiusMeters / metersPerDegLng;

        const half = sectorAngleDeg / 2;
        const start = toRadians(bearingDeg - half);
        const end = toRadians(bearingDeg + half);

        const points: [number, number][] = [];
        // start at center
        points.push([lng, lat]);

        // sample arc from start to end
        const steps = Math.max(8, Math.floor((segments * sectorAngleDeg) / 360));
        for (let i = 0; i <= steps; i++) {
          const t = i / steps;
          const theta = start + t * (end - start);
          const x = dLng * Math.sin(theta); // east-west offset
          const y = dLat * Math.cos(theta); // north-south offset
          points.push([lng + x, lat + y]);
        }

        // close back to center
        points.push([lng, lat]);
        return points;
      };

      const handleAzimuthalDrawing = (point: [number, number]) => {
        if (!isDrawing) {
          // First click sets the center
          setCurrentPath([point]);
          setIsDrawing(true);
          return;
        }

        // Second click sets the azimuth and radius
        const center = currentPath[0];
        const end = point;
        const radiusMeters = calculateDistanceMeters(center, end);
        const bearing = calculateBearingDegrees(center, end);

        const sectorAngleDeg = 60; // default sector width
        const sector = makeSectorPolygon(center, radiusMeters, bearing, sectorAngleDeg);

        // Build GeoJSON with only the sector polygon (no point or azimuth line)
        const featureCollection: GeoJSON.FeatureCollection = {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              geometry: { type: "Polygon", coordinates: [sector] },
              properties: { kind: "sector", radiusMeters, bearing, sectorAngleDeg }
            }
          ]
        };

        const newLayer: LayerProps = {
          type: "geojson",
          id: generateLayerId(),
          name: `Azimuthal ${layers.filter((l) => l.name?.startsWith("Azimuthal")).length + 1}`,
          geojson: featureCollection,
          color: [32, 32, 32, 180],
          pointRadius: 40000,
          visible: true,
        };

        setLayers([...layers, newLayer]);
        setCurrentPath([]);
        setIsDrawing(false);
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

      const handleFtp = (node: Node) => {
        console.log('Starting FTP transfer with node:', node.userId);
        // TODO: Implement FTP functionality
        alert(`FTP transfer with Node ${node.userId} - Feature coming soon!`);
      };

      const closeNodeDialog = () => {
        setIsNodeDialogOpen(false);
        setSelectedNode(null);
      };

      const toggleDrawingMode = (mode: "point" | "polygon" | "line" | "azimuthal" | null) => {
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
      
      // Debug logging for layer counts
      console.log("Layer counts:", {
        totalLayers: layers.length,
        pointLayers: pointLayers.length,
        lineLayers: lineLayers.length,
        polygonLayers: polygonLayers.length,
        nodeLayers: nodeLayers.length
      });
    
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
            color: [32, 32, 32, 100], // Darker preview for polygon
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
      // Azimuthal preview: line from center to mouse and a sector at that radius
      if (
        isDrawing &&
        drawingMode === "azimuthal" &&
        currentPath.length === 1 &&
        mousePosition
      ) {
        const center = currentPath[0];
        const radiusMeters = calculateDistanceMeters(center, mousePosition);
        const bearing = calculateBearingDegrees(center, mousePosition);
        const sector = makeSectorPolygon(center, radiusMeters, bearing, 60, 64);

        // Do not show azimuth line in preview; only show sector

        previewLayers.push({
          type: "polygon",
          id: generateLayerId(),
          name: "Preview Azimuth Sector",
          polygon: [sector],
          color: [32, 32, 32, 100],
          visible: true,
        });
      }
      if (isDrawing && currentPath.length > 0) {
        currentPath.forEach((point, index) => {
          previewLayers.push({
            type: "point",
            id: generateLayerId(),
            name: `Preview Point ${index + 1}`,
            position: point,
            color: index === 0 ? [255, 255, 0] : [255, 0, 255], // First point yellow, others magenta
            radius: 150,
            visible: true,
          });
        });
      }
    
      const scatterLayer = new ScatterplotLayer({
        id: "point-layer",
        data: pointLayers,
        getPosition: (d: LayerProps) => {
          console.log("ScatterplotLayer getPosition called with:", d);
          return d.position!;
        },
        getRadius: (d: LayerProps) => d.radius || 200,
        getFillColor: (d: LayerProps) => d.color,
        pickable: true,
        visible: true,
        onHover: (info) => setHoverInfo(info),
        onHoverEnd: () => setHoverInfo(undefined),
        radiusMinPixels: 4,
      });
      
      console.log("ScatterplotLayer created with data:", pointLayers);
    
      const previewPointLayers = previewLayers.filter((l) => l.type === "point");
      const previewLineLayers = previewLayers.filter((l) => l.type === "line");
      const previewPolygonLayers = previewLayers.filter(
        (l) => l.type === "polygon"
      );

      const previewPointLayer = new ScatterplotLayer({
        id: "preview-point-layer",
        data: previewPointLayers,
        getPosition: (d: LayerProps) => d.position!,
        getRadius: (d: LayerProps) => d.radius || 200,
        getFillColor: (d: LayerProps) => d.color,
        pickable: false,
        radiusMinPixels: 4,
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

      // DEM raster layers using BitmapLayer
      const demLayers = layers.filter((l) => l.type === "dem" && isLayerVisible(l));
      const demBitmapLayers = demLayers.map((layer) => {
        return new (require('@deck.gl/layers').BitmapLayer)({
          id: layer.id,
          image: layer.bitmap as any,
          bounds: [
            layer.bounds![0][0],
            layer.bounds![0][1],
            layer.bounds![1][0],
            layer.bounds![1][1],
          ],
          pickable: false,
          visible: layer.visible !== false,
          opacity: 0.9,
        });
      });

      // Annotation layers using TextLayer
      const annotationLayers = layers.filter((l) => l.type === "annotation" && isLayerVisible(l));
      const annotationTextLayers = annotationLayers.flatMap((layer) => {
        if (!layer.annotations || layer.annotations.length === 0) {
          return [];
        }

        try {
          const { TextLayer } = require('@deck.gl/layers');
          return new TextLayer({
            id: layer.id,
            data: layer.annotations,
            getPosition: (d: any) => d.position,
            getText: (d: any) => d.text,
            getColor: (d: any) => d.color || layer.color || [0, 0, 0],
            getSize: (d: any) => d.fontSize || 14,
            getAngle: 0,
            getTextAnchor: 'middle',
            getAlignmentBaseline: 'center',
            pickable: true,
            visible: layer.visible !== false,
            sizeScale: 1,
            fontFamily: 'Arial, sans-serif',
            fontWeight: 'normal',
            onHover: (info: any) => setHoverInfo(info),
            onHoverEnd: () => setHoverInfo(undefined),
          });
        } catch (error) {
          console.error('Error creating TextLayer:', error);
          return [];
        }
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
           //   console.log(`Loading icon for node ${node.userId}:`, iconConfig.url);
              return iconConfig;
            },
            getPosition: (node: Node) => [node.longitude, node.latitude],
            getSize: 24, // Smaller size to prevent cutting issues
            sizeScale: 1,
            getPixelOffset: [0, -10], // Offset icons slightly up to prevent cutting at bottom
            alphaCutoff: 0.001, // Even lower cutoff for better icon visibility
            billboard: true,
            sizeUnits: 'pixels',
            sizeMinPixels: 16, // Minimum size to prevent icons from becoming too small
            sizeMaxPixels: 32, // Maximum size to prevent icons from becoming too large
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
                // Close any active hover tooltip immediately on click
                setHoverInfo(undefined);
                // Only show dialog for socket nodes (nodes with network properties)
                const isSocketNode = node.hasOwnProperty('snr') && 
                                   node.hasOwnProperty('rssi') && 
                                   node.hasOwnProperty('userId') && 
                                   node.hasOwnProperty('hopCount');
                
                if (isSocketNode) {
                  console.log('Socket node clicked:', node);
                  // Set selected node and open dialog
                  setSelectedNode(node);
                  setIsNodeDialogOpen(true);
                  // Also dispatch event for backward compatibility
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
              getRadius: 12000, // Larger fallback circles to prevent cutting
              getFillColor: (node: Node) => getSignalColor(node.snr, node.rssi),
              getLineColor: [255, 255, 255, 200],
              getLineWidth: 2, // Thicker border for better visibility
              radiusMinPixels: 8, // Minimum pixel size to prevent cutting
              radiusMaxPixels: 32, // Maximum pixel size
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
        ...demBitmapLayers,
        ...annotationTextLayers,
        ...nodeIconLayers,
      ].filter(Boolean) // Remove any null/undefined layers

    // Filter out connection layers from the layers array for sidebar display
    const sidebarLayers = layers.filter(layer => {
      const name = layer.name || "";
      if (name.includes("Connection")) return false;
      if (name.startsWith("Polygon Point")) return false; // hide polygon vertex point layers from sidebar
      return true;
    });

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
        handleFtp,
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
        // New device storage functions
        downloadLayersToDevice,
        importLayersFromDevice,
        // File upload functions
        uploadGeoJsonFile,
        uploadDemFile,
        uploadAnnotationFile,
        uploadGeoJsonFromFilesystem,
        uploadDemFromFilesystem,
        handleFileImport,
        // Storage directory functions
        getStorageDirectory,
        setStorageDirectory: async (directory: Directory) => {
          await setStorageDirectoryUtil(directory);
          showMessage(`Storage location changed to: ${getStorageDirectoryName(directory)}`);
        },
        getStorageDirectoryName,
        getStorageDirectoryPath,
      };
    };