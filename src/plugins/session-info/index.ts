import { Capacitor, registerPlugin } from "@capacitor/core";

export type SessionInfoResult = {
  isLoggedIn: boolean;
  username: string;
};

export interface SessionInfoPlugin {
  getSession(): Promise<SessionInfoResult>;
}

function isAndroidNative(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}

function createStub(): SessionInfoPlugin {
  return {
    async getSession() {
      return { isLoggedIn: false, username: "" };
    },
  };
}

/** MCSA session from Android prefs. Only registered on Android; web/Electron use stub. */
export const SessionInfo: SessionInfoPlugin = isAndroidNative()
  ? registerPlugin<SessionInfoPlugin>("SessionInfo")
  : createStub();
