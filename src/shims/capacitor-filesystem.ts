/**
 * Shim for @capacitor/filesystem — uses window.electronAPI IPC.
 */

export const Directory = {
  Documents: "DOCUMENTS",
  Data: "DATA",
  Cache: "CACHE",
  External: "EXTERNAL",
  ExternalStorage: "EXTERNAL_STORAGE",
  Library: "LIBRARY",
  ExternalCache: "EXTERNAL_CACHE",
  LibraryNoCloud: "LIBRARY_NO_CLOUD",
  Temporary: "TEMPORARY",
} as const;

export type Directory = (typeof Directory)[keyof typeof Directory];

export const Encoding = {
  UTF8: "utf8",
  ASCII: "ascii",
  UTF16: "utf16",
} as const;

export type Encoding = (typeof Encoding)[keyof typeof Encoding];

function api() {
  return (window as any).electronAPI;
}

export const Filesystem = {
  async readFile(options: { path: string; directory?: Directory; encoding?: Encoding }) {
    const dir = options.directory || Directory.Documents;
    const data = await api().readFileInDir(options.path, dir, options.encoding === Encoding.UTF8 ? undefined : "base64");
    return { data };
  },

  async writeFile(options: { path: string; directory?: Directory; data: string; encoding?: Encoding; recursive?: boolean }) {
    const dir = options.directory || Directory.Documents;
    const enc = options.encoding === Encoding.UTF8 ? undefined : "base64";
    const uri = await api().writeFileInDir(options.path, dir, options.data, enc);
    return { uri };
  },

  async deleteFile(options: { path: string; directory?: Directory }) {
    const dir = options.directory || Directory.Documents;
    await api().deleteFileInDir(options.path, dir);
  },

  async mkdir(options: { path: string; directory?: Directory; recursive?: boolean }) {
    const dir = options.directory || Directory.Documents;
    await api().mkdir(options.path, dir);
  },

  async readdir(options: { path: string; directory?: Directory }) {
    const dir = options.directory || Directory.Documents;
    const files = await api().readdirInDir(options.path, dir);
    return { files };
  },

  async stat(options: { path: string; directory?: Directory }) {
    const dir = options.directory || Directory.Documents;
    const basePath = await api().resolveDirectory(dir);
    const fullPath = basePath + "/" + options.path;
    return await api().stat(fullPath);
  },

  async downloadFile(options: { path: string; url: string; directory?: Directory }) {
    const response = await fetch(options.url);
    const blob = await response.blob();
    // Convert blob to base64 using FileReader (non-blocking, runs on browser C++ engine)
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = reader.result as string;
        resolve(dataUrl.split(",")[1]); // strip data:...;base64, prefix
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    const dir = options.directory || Directory.Documents;
    const fullPath = await api().writeFileInDir(options.path, dir, base64, "base64");
    return { path: fullPath };
  },
};

