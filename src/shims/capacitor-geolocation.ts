/**
 * Shim for @capacitor/geolocation — uses browser's navigator.geolocation.
 * Works natively in Electron.
 */

export const Geolocation = {
  async requestPermissions() {
    // Browser geolocation auto-prompts. Just check if API exists.
    if (!navigator.geolocation) {
      return { location: "denied" as const };
    }
    return { location: "granted" as const };
  },

  async getCurrentPosition(options?: { enableHighAccuracy?: boolean; timeout?: number }) {
    return new Promise<any>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({
          coords: {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            altitude: pos.coords.altitude,
            altitudeAccuracy: pos.coords.altitudeAccuracy,
            heading: pos.coords.heading,
            speed: pos.coords.speed,
          },
          timestamp: pos.timestamp,
        }),
        (err) => reject(err),
        {
          enableHighAccuracy: options?.enableHighAccuracy ?? true,
          timeout: options?.timeout ?? 10000,
        }
      );
    });
  },

  async watchPosition(
    options: { enableHighAccuracy?: boolean },
    callback: (position: any, err: any) => void
  ): Promise<string> {
    const id = navigator.geolocation.watchPosition(
      (pos) => callback({
        coords: {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          altitude: pos.coords.altitude,
          altitudeAccuracy: pos.coords.altitudeAccuracy,
          heading: pos.coords.heading,
          speed: pos.coords.speed,
        },
        timestamp: pos.timestamp,
      }, null),
      (err) => callback(null, { message: err.message }),
      { enableHighAccuracy: options?.enableHighAccuracy ?? true }
    );
    return String(id);
  },

  async clearWatch(options: { id: string }) {
    navigator.geolocation.clearWatch(Number(options.id));
  },
};

