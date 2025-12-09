import { useEffect, useRef } from "react";
import { useUserLocation } from "@/store/layers-store";
import { Geolocation } from "@capacitor/geolocation";

export default function OfflineLocationTracker() {
  const { showUserLocation, setUserLocation, setUserLocationError } =
    useUserLocation();
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // Only track location when user has toggled it on
    if (!showUserLocation) {
      // Clear any existing interval if location is disabled
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

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
          timeout: 30000, // 30 seconds - increased for tablets/GPS devices
        });

        if (!isMounted) return;

        const location = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy || 0,
        };
        setUserLocation(location);
        setUserLocationError(null);
      } catch (error: any) {
        if (!isMounted) return;
        console.error("Geolocation error:", error);
        setUserLocationError(error.message || "Failed to get location");
      }
    };

    // Get location immediately when toggled on
    getLocation();

    // Then poll every 30 seconds for updates
    intervalRef.current = setInterval(() => {
      if (isMounted && showUserLocation) {
        getLocation();
      }
    }, 30000); // 30 seconds

    return () => {
      isMounted = false;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [showUserLocation, setUserLocation, setUserLocationError]);

  return null;
}
