import { MessageSquare, Upload, Video } from "lucide-react";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { useNodeDialog, useSelectedNode } from "@/store/layers-store";
import type { Node } from "@/lib/definitions";

const ActionDialog = () => {
  const { isNodeDialogOpen, setIsNodeDialogOpen } = useNodeDialog();
  const { selectedNode } = useSelectedNode();
  const handleVoiceCall = (node: Node) => {
    alert(`Voice call with Node ${node.userId} - Feature coming soon!`);
  };

  const handleVideoCall = (node: Node) => {
    alert(`Video call with Node ${node.userId} - Feature coming soon!`);
  };

  const handleSendMessage = (node: Node) => {
    alert(`Send message to Node ${node.userId} - Feature coming soon!`);
  };

  const handleFtp = (node: Node) => {
    alert(`FTP transfer with Node ${node.userId} - Feature coming soon!`);
  };
  return (
    <Dialog open={isNodeDialogOpen} onOpenChange={setIsNodeDialogOpen}>
      <DialogContent className="max-w-lg">
        <DialogHeader className="pb-4">
          <DialogTitle className="flex items-center gap-3 text-lg">
            <div className="w-4 h-4 bg-blue-500 rounded-full"></div>
            Node {selectedNode?.userId}
          </DialogTitle>
        </DialogHeader>

        {selectedNode && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-6 text-sm">
              <div className="space-y-1">
                <span className="font-medium text-gray-600">SNR:</span>
                <p className="font-mono text-base">{selectedNode.snr} dB</p>
              </div>
              <div className="space-y-1">
                <span className="font-medium text-gray-600">RSSI:</span>
                <p className="font-mono text-base">{selectedNode.rssi} dBm</p>
              </div>
              <div className="space-y-1">
                <span className="font-medium text-gray-600">Distance:</span>
                <p className="font-mono text-base">
                  {selectedNode.distance?.toFixed(2)} m
                </p>
              </div>
              <div className="space-y-1">
                <span className="font-medium text-gray-600">Hop Count:</span>
                <p className="font-mono text-base">{selectedNode.hopCount}</p>
              </div>
            </div>

            <div className="border-t pt-6 space-y-2">
              <span className="font-medium text-gray-600 text-sm">
                Location:
              </span>
              <p className="font-mono text-sm text-gray-800 bg-gray-50 p-3 rounded-lg">
                {selectedNode.latitude.toFixed(6)},{" "}
                {selectedNode.longitude.toFixed(6)}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-4">
              <Button
                onClick={() => {
                  handleVoiceCall(selectedNode);
                  setIsNodeDialogOpen(false);
                }}
                className="flex-1 h-11 text-white"
                style={{ backgroundColor: "#606246" }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = "#4d4f3a";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = "#606246";
                }}
                size="default"
              >
                <img
                  src="/icons/walkie-talkie.png"
                  alt="Call"
                  className="w-4 h-4 mr-2"
                />
                Voice Call
              </Button>

              <Button
                onClick={() => {
                  handleVideoCall(selectedNode);
                  setIsNodeDialogOpen(false);
                }}
                className="flex-1 h-11 text-white"
                style={{ backgroundColor: "#606246" }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = "#4d4f3a";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = "#606246";
                }}
                size="default"
              >
                <Video size={18} className="mr-2" />
                Video Call
              </Button>

              <Button
                onClick={() => {
                  handleSendMessage(selectedNode);
                  setIsNodeDialogOpen(false);
                }}
                className="flex-1 h-11 text-white"
                style={{ backgroundColor: "#606246" }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = "#4d4f3a";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = "#606246";
                }}
                size="default"
              >
                <MessageSquare size={18} className="mr-2" />
                Message
              </Button>

              <Button
                onClick={() => {
                  handleFtp(selectedNode);
                  setIsNodeDialogOpen(false);
                }}
                className="flex-1 h-11 text-white"
                style={{ backgroundColor: "#606246" }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = "#4d4f3a";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = "#606246";
                }}
                size="default"
              >
                <Upload size={18} className="mr-2" />
                FTP
              </Button>
            </div>
            {selectedNode.connectedNodeIds &&
              selectedNode.connectedNodeIds.length > 0 && (
                <div className="border-t pt-6 space-y-2">
                  <span className="font-medium text-gray-600 text-sm">
                    Connected Nodes:
                  </span>
                  <p className="font-mono text-sm text-gray-800 bg-gray-50 p-3 rounded-lg">
                    {selectedNode.connectedNodeIds.join(", ")}
                  </p>
                </div>
              )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default ActionDialog;
