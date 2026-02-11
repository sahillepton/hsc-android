import { useState, useEffect } from "react";
import { useUdpConfigStore } from "@/store/udp-config-store";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

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
  const [inputHost, setInputHost] = useState(host || "");
  const [inputPort, setInputPort] = useState(port > 0 ? port.toString() : "");
  const [error, setError] = useState<string | null>(null);

  // Sync state when dialog opens or store values change
  useEffect(() => {
    if (isOpen) {
      setInputHost(host || "");
      setInputPort(port > 0 ? port.toString() : "");
      setError(null);
    }
  }, [isOpen, host, port]);

  const handleSubmit = () => {
    // Validate host
    if (!inputHost.trim()) {
      setError("Host cannot be empty. Please enter a valid IP address.");
      return;
    }

    // Validate port
    const portNum = parseInt(inputPort, 10);
    if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
      setError(
        "Invalid port number. Please enter a number between 1 and 65535."
      );
      return;
    }

    // Save config
    setConfig(inputHost.trim(), portNum);
    onConfigSet();
    onClose();
  };

  const handleCancel = () => {
    setError(null);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleCancel()}>
      <DialogContent
        className="sm:max-w-md bg-white border-gray-200 shadow-xl"
        showCloseButton={false}
      >
        <DialogHeader>
          <DialogTitle className="text-gray-900 font-semibold">
            UDP Server Configuration
          </DialogTitle>
          <DialogDescription className="text-gray-500 text-sm">
            Enter the UDP server IP address and port to connect.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="host" className="text-gray-700 text-sm font-medium">
              Server IP Address
            </Label>
            <Input
              id="host"
              type="text"
              placeholder="e.g., 192.168.1.100"
              value={inputHost}
              onChange={(e) => {
                setInputHost(e.target.value);
                setError(null);
              }}
              className="bg-white border-gray-300 text-gray-900 placeholder:text-gray-400 focus:border-blue-500 h-10"
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="port" className="text-gray-700 text-sm font-medium">
              Server Port
            </Label>
            <Input
              id="port"
              type="number"
              placeholder="e.g., 5000"
              value={inputPort}
              onChange={(e) => {
                setInputPort(e.target.value);
                setError(null);
              }}
              min={1}
              max={65535}
              className="bg-white border-gray-300 text-gray-900 placeholder:text-gray-400 focus:border-blue-500 h-10"
            />
          </div>

          {error && <p className="text-red-500 text-sm">{error}</p>}
        </div>

        <DialogFooter className="flex flex-row justify-end gap-3 pt-2">
          <Button
            variant="outline"
            onClick={handleCancel}
            className="border-gray-300 text-gray-700 bg-white hover:bg-gray-100 px-6"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            className="bg-blue-600 hover:bg-blue-700 text-white px-6"
          >
            Connect
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default UdpConfigDialog;
