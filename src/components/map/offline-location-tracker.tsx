import { useEffect, useRef } from "react";
import { useUserLocation } from "@/store/layers-store";
import { Geolocation } from "@capacitor/geolocation";

export default function OfflineLocationTracker() {
  const { showUserLocation, setUserLocation, setUserLocationError } =
    useUserLocation();
  const watchIdRef = useRef<string | null>(null);

  useEffect(() => {
    // Only track location when user has toggled it on
    if (!showUserLocation) {
      // Clear any existing watch if location is disabled
      if (watchIdRef.current) {
        Geolocation.clearWatch({ id: watchIdRef.current });
        watchIdRef.current = null;
      }
      return;
    }

    let isMounted = true;

    const startWatching = async () => {
      try {
        const permission = await Geolocation.requestPermissions();

        if (permission.location !== "granted") {
          setUserLocationError("Location permission denied");
          return;
        }

        if (!isMounted) return;

        const watchId = await Geolocation.watchPosition(
          { enableHighAccuracy: true },
          (pos, err) => {
            if (!isMounted) return;

            if (err) {
              setUserLocationError(err.message);
              return;
            }

            if (pos) {
              const location = {
                lat: pos.coords.latitude,
                lng: pos.coords.longitude,
                accuracy: pos.coords.accuracy || 0,
              };
              console.log("User location updated:", location);
              setUserLocation(location);
              setUserLocationError(null);
            }
          }
        );

        if (isMounted) {
          watchIdRef.current = watchId;
        }
      } catch (error: any) {
        if (!isMounted) return;
        console.error("Geolocation error:", error);
        setUserLocationError(
          error.message || "Failed to start location tracking"
        );
      }
    };

    startWatching();

    return () => {
      isMounted = false;
      if (watchIdRef.current) {
        Geolocation.clearWatch({ id: watchIdRef.current });
        watchIdRef.current = null;
      }
    };
  }, [showUserLocation, setUserLocation, setUserLocationError]);

  return null;
}
