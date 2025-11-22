import { useEffect, useRef } from "react";
import { useUdpConfigStore } from "@/store/udp-config-store";

interface UdpConfigDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfigSet: () => void;
}

const UdpConfigDialog = ({
  isOpen,
  onClose,
  onConfigSet,
}: UdpConfigDialogProps) => {
  const { host, port, setConfig } = useUdpConfigStore();
  const hasPromptedRef = useRef(false);

  useEffect(() => {
    if (isOpen && !hasPromptedRef.current) {
      hasPromptedRef.current = true;

      const promptConfig = () => {
        // Prompt for host
        const newHost = prompt(`Enter UDP Server IP Address:`, host);

        if (newHost === null) {
          // User cancelled
          hasPromptedRef.current = false;
          onClose();
          return;
        }

        if (!newHost.trim()) {
          alert("Host cannot be empty. Please enter a valid IP address.");
          hasPromptedRef.current = false;
          promptConfig();
          return;
        }

        // Prompt for port
        const newPort = prompt(`Enter UDP Server Port:`, port.toString());

        if (newPort === null) {
          // User cancelled
          hasPromptedRef.current = false;
          onClose();
          return;
        }

        const portNum = parseInt(newPort, 10);
        if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
          alert(
            "Invalid port number. Please enter a number between 1 and 65535."
          );
          hasPromptedRef.current = false;
          promptConfig();
          return;
        }

        // Save config
        setConfig(newHost.trim(), portNum);
        onConfigSet();
        hasPromptedRef.current = false;
        onClose();
      };

      // Small delay to ensure dialog state is ready
      setTimeout(() => {
        promptConfig();
      }, 100);
    }
  }, [isOpen, host, port, setConfig, onConfigSet, onClose]);

  // Reset the ref when dialog closes
  useEffect(() => {
    if (!isOpen) {
      hasPromptedRef.current = false;
    }
  }, [isOpen]);

  return null;
};

export default UdpConfigDialog;
