/**
 * Parse JSON layer export file
 */
export interface JsonImportData {
  version?: string;
  layers: any[];
  nodeIconMappings?: Record<string, string>;
}

export async function parseJsonImportFile(
  file: File
): Promise<JsonImportData> {
  const text = await file.text();
  const importData = JSON.parse(text);

  if (!importData.version || !Array.isArray(importData.layers)) {
    throw new Error("Invalid layers data format");
  }

  if (!importData.layers || !Array.isArray(importData.layers)) {
    throw new Error("Invalid layers data format");
  }

  return importData;
}

