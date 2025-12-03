import type { LayerProps } from "./definitions";

export const SKETCH_LAYER_TYPES: LayerProps["type"][] = [
  "point",
  "line",
  "polygon",
  "azimuth",
];

export const isSketchLayer = (layer: LayerProps) =>
  SKETCH_LAYER_TYPES.includes(layer.type);
