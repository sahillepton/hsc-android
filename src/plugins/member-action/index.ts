import { registerPlugin } from "@capacitor/core";

/** Tooltip → native: only these two fields are sent. */
export interface MemberActionData {
  globalId: string;
  action: "video" | "ftp" | "call" | "message";
}

export interface MemberActionPlugin {
  notifyAction(options: MemberActionData): Promise<{ success: boolean }>;

  addListener(
    eventName: "actionResponse",
    listenerFunc: (event: { globalId: string; status: string }) => void,
  ): Promise<{ remove: () => void }>;
}

function isElectron(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof (window as Window & { electronAPI?: unknown }).electronAPI !==
      "undefined"
  );
}

function createDesktopPlugin(): MemberActionPlugin {
  return {
    async notifyAction(options: MemberActionData) {
      void options;
      return { success: false };
    },
    async addListener(
      eventName: "actionResponse",
      listenerFunc: (event: { globalId: string; status: string }) => void,
    ) {
      void eventName;
      void listenerFunc;
      return { remove: () => {} };
    },
  };
}

const MemberAction: MemberActionPlugin = isElectron()
  ? createDesktopPlugin()
  : registerPlugin<MemberActionPlugin>("MemberAction");

export default MemberAction;
