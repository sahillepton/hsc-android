/**
 * Shim for @capacitor/app — stub on desktop.
 */
export const App = {
  async exitApp() {
    window.close();
  },
  async getInfo() {
    return { name: "HSC GIS Desktop", id: "com.hsc.desktop", build: "1", version: "1.0.0" };
  },
  async addListener(_event: string, _handler: any) {
    return { remove: () => {} };
  },
};

