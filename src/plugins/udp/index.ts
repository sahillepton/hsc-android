import { registerPlugin } from "@capacitor/core";

export interface UdpPlugin {
  create(options: { address: string; port: number }): Promise<void>;
  send(options: { address: string; port: number; data: string }): Promise<void>;
  closeAllSockets(): Promise<void>;
  addListener(
    eventName: "udpMessage",
    listenerFunc: (event: { buffer: ArrayBuffer }) => void
  ): Promise<{ remove: () => void }>;
}

export const Udp = registerPlugin<UdpPlugin>("Udp");
