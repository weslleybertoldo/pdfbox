import { Capacitor, registerPlugin } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";

/**
 * Wrapper do IntentReceiverPlugin (Android): entrega ao JS arquivos abertos
 * via ACTION_VIEW ("Abrir com → PDFBox"). O plugin copia o content:// pro
 * cacheDir nativo; aqui lemos esse cache via Filesystem e devolvemos bytes.
 */

interface PendingFileResult {
  path?: string; // caminho absoluto no cacheDir nativo
  name?: string; // DISPLAY_NAME original (fallback: nome do cache)
  mimeType?: string;
}

interface IntentReceiverNative {
  getPendingFile(): Promise<PendingFileResult>;
  addListener(event: "fileOpened", cb: () => void): Promise<unknown>;
}

const IntentReceiver = registerPlugin<IntentReceiverNative>("IntentReceiver");

export interface ExternalFile {
  bytes: Uint8Array;
  name: string;
  mimeType: string;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function readPending(): Promise<ExternalFile | null> {
  const { path, name, mimeType } = await IntentReceiver.getPendingFile();
  if (!path || !mimeType) return null; // sem intent pendente
  const cacheName = path.split("/").pop()!;
  // no nativo readFile devolve base64 (string)
  const { data } = await Filesystem.readFile({ path: cacheName, directory: Directory.Cache });
  return { bytes: base64ToBytes(data as string), name: name ?? cacheName, mimeType };
}

/** Arquivo pendente de um ACTION_VIEW (cold start), ou null se não houver. */
export async function getPendingFile(): Promise<ExternalFile | null> {
  if (!Capacitor.isNativePlatform()) return null;
  try {
    return await readPending();
  } catch (e) {
    console.error("intentReceiver.getPendingFile", e);
    return null;
  }
}

/** Dispara cb quando um ACTION_VIEW chega com o app JÁ aberto (onNewIntent). */
export function addFileOpenedListener(cb: (f: ExternalFile) => void): void {
  if (!Capacitor.isNativePlatform()) return;
  void IntentReceiver.addListener("fileOpened", () => {
    readPending()
      .then((f) => {
        if (f) cb(f);
      })
      .catch((e) => console.error("intentReceiver.fileOpened", e));
  });
}
