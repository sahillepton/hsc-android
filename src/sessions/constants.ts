import { Directory } from "@capacitor/filesystem";

export const HSC_BASE_DIR = "HSC-SESSIONS";
export const HSC_FILES_DIR = `${HSC_BASE_DIR}/FILES`; // inside Directory.Documents
export const HSC_MANIFEST_PATH = `${HSC_BASE_DIR}/manifest.json`;

export const HSC_DIRECTORY = Directory.Documents;

// Suggested limits used by helpers (Cursor can adjust later)
export const MAX_UPLOAD_FILES = 2;
