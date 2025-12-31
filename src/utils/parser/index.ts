/**
 * Parser Module - Common access point for all file parsers
 * 
 * This module provides a centralized interface for all file parsing operations.
 * Each parser is in its own file for better organization and maintainability.
 */

// DEM/Raster Parsers
export {
  parseDemFile,
  createDemLayer,
  type DemParseResult,
  type DemParseOptions,
} from "./dem-parser";

// Vector/GeoJSON Parsers
export {
  parseVectorFile,
  createVectorLayer,
  parseVectorInWorker,
  extractSizeFromProperties,
  type VectorParseOptions,
} from "./vector-parser";

// Annotation Parsers
export {
  parseAnnotationFile,
  createAnnotationLayer,
  type AnnotationParseOptions,
  type Annotation,
} from "./annotation-parser";

// JSON Import Parsers
export {
  parseJsonImportFile,
  type JsonImportData,
} from "./json-import-parser";

// ZIP Parsers
export {
  findAllValidFilesInZip,
  type ValidFile,
} from "./zip-parser";

