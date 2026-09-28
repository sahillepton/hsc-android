import { Directory } from "@capacitor/filesystem";

/** Base folder name when no MCSA username (Windows, Electron, standalone GIS APK). */
export const HSC_SESSION_PREFIX = "HSC-SESSIONS";

let resolvedUsernameSegment: string | null = null;

/**
 * "puru bhargava" → "puru_bhargava" (safe single path segment).
 */
export function sanitizeUsernameForSessionPath(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  return t
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

/**
 * Integrated MCSA Android: call with prefs username so files live under
 * Documents/HSC-SESSIONS-{user}/… . Empty or missing username → plain HSC-SESSIONS.
 */
export function configureSessionPathsFromUsername(
  username: string | null | undefined,
): void {
  const t = (username ?? "").trim();
  if (!t) {
    resolvedUsernameSegment = null;
    return;
  }
  const sanitized = sanitizeUsernameForSessionPath(t);
  resolvedUsernameSegment = sanitized || null;
}

export function getHscBaseDir(): string {
  if (resolvedUsernameSegment) {
    return `${HSC_SESSION_PREFIX}-${resolvedUsernameSegment}`;
  }
  return HSC_SESSION_PREFIX;
}

export function getHscFilesDir(): string {
  return `${getHscBaseDir()}/FILES`;
}

export function getHscManifestPath(): string {
  return `${getHscBaseDir()}/manifest.json`;
}

export function getHscUntrackedPath(): string {
  return `${getHscBaseDir()}/untracked.json`;
}

export function getAutosaveSessionPath(): string {
  return `${getHscBaseDir()}/autosave_session.zip`;
}

// External app-specific storage:
// Android → /storage/emulated/0/Android/data/<pkg>/files/  (visible via USB as Internal storage/Android/data/<pkg>/files/)
// Electron → app.getPath("userData")
export const HSC_DIRECTORY = Directory.External;

// Suggested limits used by helpers (Cursor can adjust later)
export const MAX_UPLOAD_FILES = 2;
