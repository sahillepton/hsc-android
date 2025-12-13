import { Capacitor } from "@capacitor/core";

export async function stagedPathToFile(params: {
  absolutePath: string;
  originalName: string;
  mimeType?: string;
}): Promise<File> {
  const url = Capacitor.convertFileSrc(params.absolutePath);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to read staged file: ${res.status}`);

  const blob = await res.blob();
  return new File([blob], params.originalName, {
    type: params.mimeType || blob.type || "application/octet-stream",
  });
}
