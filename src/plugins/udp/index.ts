import { registerPlugin } from "@capacitor/core";

export interface UdpPlugin {
  create(options?: Record<string, unknown>): Promise<void>;
  send(options: { data: string }): Promise<void>;
  closeAllSockets(): Promise<void>;
  addListener(
    eventName: "udpMessage",
    listenerFunc: (event: { buffer: ArrayBuffer }) => void
  ): Promise<{ remove: () => void }>;
}

export const Udp = registerPlugin<UdpPlugin>("Udp");
