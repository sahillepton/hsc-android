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

const MemberAction = registerPlugin<MemberActionPlugin>("MemberAction");

export default MemberAction;
