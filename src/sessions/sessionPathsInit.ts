import { Capacitor } from "@capacitor/core";
import { configureSessionPathsFromUsername } from "./constants";
import { SessionInfo } from "@/plugins/session-info";

/**
 * Must run before any session filesystem use. Integrated Android sets
 * HSC-SESSIONS-{sanitized_username}; other platforms keep HSC-SESSIONS.
 */
export async function initSessionPaths(): Promise<void> {
  if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android") {
    try {
      const session = await SessionInfo.getSession();
      configureSessionPathsFromUsername(session.username);
      if (session.username?.trim()) {
        console.log(
          "[SessionPaths] Using user-scoped session dir:",
          session.username,
        );
      }
    } catch (e) {
      console.warn(
        "[SessionPaths] SessionInfo failed; using default HSC-SESSIONS",
        e,
      );
      configureSessionPathsFromUsername(undefined);
    }
  } else {
    configureSessionPathsFromUsername(undefined);
  }
}
