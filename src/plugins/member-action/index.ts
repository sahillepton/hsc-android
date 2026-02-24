import { registerPlugin } from "@capacitor/core";

export interface MemberActionData {
  memberId: string; // Global ID of the member
  action: "call" | "message" | "info"; // Action type
  memberName?: string; // Optional: Member's name
  phoneNumber?: string; // Optional: Phone number for call/message
  metadata?: string; // Optional: Any additional JSON data
}

export interface MemberActionPlugin {
  /**
   * Notify the native app about a member action
   * Called when user clicks Call/Message button in tooltip
   */
  notifyAction(options: MemberActionData): Promise<{ success: boolean }>;

  /**
   * Listen for responses from native app (optional)
   */
  addListener(
    eventName: "actionResponse",
    listenerFunc: (event: { memberId: string; status: string }) => void
  ): Promise<{ remove: () => void }>;
}

// ── Platform detection ──
function isElectron(): boolean {
  return typeof window !== "undefined" && !!(window as any).electronAPI;
}

// ── Electron desktop stub (not required on desktop) ──
function createDesktopPlugin(): MemberActionPlugin {
  return {
    async notifyAction(_options: MemberActionData) {
      return { success: false };
    },
    async addListener(
      _eventName: "actionResponse",
      _listenerFunc: (event: { memberId: string; status: string }) => void
    ) {
      return { remove: () => {} };
    },
  };
}

// ── Export: Electron uses stub, Android uses Capacitor native plugin ──
const MemberAction: MemberActionPlugin = isElectron()
  ? createDesktopPlugin()
  : registerPlugin<MemberActionPlugin>("MemberAction");

export default MemberAction;
