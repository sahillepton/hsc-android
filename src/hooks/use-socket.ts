import { useEffect, useRef, useState } from 'react';


export const useSocket = (url: string) => {
  const [isConnected, setIsConnected] = useState(false);
  const [data, setData] = useState<any | null>(null);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    console.log('Attempting to connect to WebSocket:', url);
    const socket = new WebSocket(url);
    socketRef.current = socket;

    socket.onopen = () => {
      console.log('WebSocket connected successfully to:', url);
      setIsConnected(true);
    };

    socket.onmessage = (event) => {
      try {
        console.log('Raw WebSocket message received:', event.data);
        const parsedData = JSON.parse(event.data);
        console.log('Parsed WebSocket data:', parsedData);
        
        // Handle different data formats
        let nodeData;
        if (parsedData.decoded && parsedData.decoded.nodes) {
          // Data has a decoded.nodes structure
          nodeData = parsedData;
          console.log('Using parsedData with decoded.nodes structure:', nodeData);
        } else if (parsedData.nodes) {
          // Data is wrapped in a "nodes" property
          nodeData = parsedData;
          console.log('Using parsedData with nodes property:', nodeData);
        } else if (Array.isArray(parsedData)) {
          // Data is directly an array of nodes
          nodeData = parsedData;
          console.log('Using parsedData directly (array):', nodeData);
        } else {
          // Data might be a single object or other format
          nodeData = parsedData;
          console.log('Using parsedData directly (object):', nodeData);
        }
        
        console.log('Setting data to:', nodeData);
        setData(nodeData);
      } catch (error) {
        console.error('Error parsing WebSocket data:', error);
        console.error('Raw data that failed to parse:', event.data);
      }
    };

    socket.onclose = (event) => {
      console.log('WebSocket disconnected. Code:', event.code, 'Reason:', event.reason);
      setIsConnected(false);
    };

    socket.onerror = (error) => {
      console.error('WebSocket error:', error);
      setIsConnected(false);
    };

    return () => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.close();
      }
    };
  }, [url]);

  const sendMessage = (message: any) => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(message));
    }
  };



  return {
    isConnected,
    data,
    sendMessage,
  };
};
