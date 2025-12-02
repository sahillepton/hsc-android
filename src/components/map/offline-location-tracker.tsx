import { useEffect, useRef } from "react";
import { useUserLocation } from "@/store/layers-store";
import { Geolocation } from "@capacitor/geolocation";

export default function OfflineLocationTracker() {
  const { setUserLocation, setUserLocationError } = useUserLocation();
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    let isMounted = true;

    const getLocation = async () => {
      try {
        const permission = await Geolocation.requestPermissions();

        if (permission.location !== "granted") {
          setUserLocationError("Location permission denied");
          return;
        }

        const position = await Geolocation.getCurrentPosition({
          enableHighAccuracy: true,
          timeout: 5000,
        });

        if (!isMounted) return;

        const location = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy || 0,
        };
        console.log("User location updated:", location);
        setUserLocation(location);
        setUserLocationError(null);
      } catch (error: any) {
        if (!isMounted) return;
        console.error("Geolocation error:", error);
        setUserLocationError(error.message || "Failed to get location");
      }
    };

    // Get location immediately
    getLocation();

    // Then poll every 5 seconds for updates
    intervalRef.current = setInterval(() => {
      if (isMounted) {
        getLocation();
      }
    }, 5000);

    return () => {
      isMounted = false;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [setUserLocation, setUserLocationError]);

  return null;
}
