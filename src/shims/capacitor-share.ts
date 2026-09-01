/**
 * Shim for @capacitor/share — stub on desktop.
 */
export const Share = {
  async share(_options: { title?: string; text?: string; url?: string; dialogTitle?: string }) {
    console.warn("[ShareShim] Share not available on desktop");
    return { activityType: undefined };
  },

  async canShare() {
    return { value: false };
  },
};

