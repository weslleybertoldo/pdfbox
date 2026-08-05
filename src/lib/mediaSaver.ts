import { Capacitor, registerPlugin } from "@capacitor/core";

interface MediaSaverPlugin {
  save(options: {
    data: string; // base64 sem prefixo data:
    fileName: string;
    mimeType: string;
    collection: "downloads" | "images" | "video";
  }): Promise<{ uri: string }>;
  saveFromPath(options: {
    path: string; // caminho absoluto no dispositivo (ex.: cache do VideoCompressor)
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

/**
 * Salva um arquivo já existente no disco nativo (ex.: mp4 comprimido pelo
 * VideoCompressor) direto no MediaStore, via streaming — sem passar pelo JS.
 */
export async function saveFileFromPath(
  path: string,
  fileName: string,
  mimeType: string,
  collection: "downloads" | "images" | "video",
): Promise<string> {
  if (!Capacitor.isNativePlatform()) {
    throw new Error("saveFileFromPath só está disponível no app nativo.");
  }
  const { uri } = await MediaSaver.saveFromPath({ path, fileName, mimeType, collection });
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
