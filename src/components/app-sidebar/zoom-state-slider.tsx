import { Slider } from "../ui/slider";
import { useLayers, useFocusLayerRequest } from "@/store/layers-store";

interface ZoomStateSliderProps {
  layerId: string;
}

const ZoomStateSlider = ({ layerId }: ZoomStateSliderProps) => {
  const { layers } = useLayers();
  const { updateLayer } = useFocusLayerRequest();
  const layer = layers.find((l) => l.id === layerId);

  const zoomState = layer?.zoomState ?? 1;

  const handleValueChange = (values: number[]) => {
    if (layer) {
      updateLayer(layerId, {
        ...layer,
        zoomState: values[0],
      });
    }
  };

  return (
    <div className="mb-2">
      <label className="text-xs font-medium text-muted-foreground">
        Zoom State
      </label>
      <Slider
        min={1}
        max={12}
        step={1}
        value={[zoomState]}
        onValueChange={handleValueChange}
        className="mt-2"
      />
      <div className="flex justify-between text-xs text-muted-foreground mt-1">
        <span>1</span>
        <span className="font-medium">Current: {zoomState}</span>
        <span>12</span>
      </div>
    </div>
  );
};

export default ZoomStateSlider;
