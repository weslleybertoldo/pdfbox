import { Capacitor, registerPlugin } from "@capacitor/core";

interface MediaSaverPlugin {
  save(options: {
    data: string; // base64 sem prefixo data:
    fileName: string;
    mimeType: string;
    collection: "downloads" | "images" | "video";
  }): Promise<{ uri: string }>;
}
const MediaSaver = registerPlugin<MediaSaverPlugin>("MediaSaver");

export async function saveToDevice(
  blob: Blob,
  fileName: string,
  collection: "downloads" | "images" | "video",
): Promise<string> {
  if (!Capacitor.isNativePlatform()) {
    // web/dev: download normal
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    return fileName;
  }
  const base64 = await blobToBase64(blob);
  const { uri } = await MediaSaver.save({
    data: base64,
    fileName,
    mimeType: blob.type || "application/octet-stream",
    collection,
  });
  return uri;
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve((r.result as string).split(",")[1]);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}
