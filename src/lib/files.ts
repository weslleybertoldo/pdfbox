import { Capacitor } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { blobToBase64 } from "./mediaSaver";

/** accept de imagem padrão para pickFiles (conversão e compressão de imagem). */
export const IMG_ACCEPT = "image/png,image/jpeg,image/webp";

/** MIME de .docx (viewer/editor de Word, intent "Abrir com", ResultPanel). */
export const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** O arquivo é um Word .docx? (por MIME ou extensão — intents nem sempre têm os dois) */
export const isDocxFile = (name: string, mimeType: string): boolean =>
  mimeType === DOCX_MIME || /\.docx$/i.test(name);

/** Abre o file picker e devolve os arquivos escolhidos. */
export function pickFiles(accept: string, multiple = false): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = multiple;
    input.onchange = () => resolve(Array.from(input.files ?? []));
    // cancelamento: WebViews Chromium modernas disparam 'cancel' no input
    input.addEventListener("cancel", () => resolve([]));
    // cancelamento (fallback): resolve vazio ao voltar o foco sem seleção
    window.addEventListener(
      "focus",
      () => setTimeout(() => resolve(Array.from(input.files ?? [])), 300),
      { once: true },
    );
    input.click();
  });
}

/** Compartilha qualquer blob: grava no cache privado e abre a share sheet. */
export async function shareBlob(blob: Blob, fileName: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    return;
  }
  const { uri } = await Filesystem.writeFile({
    path: fileName,
    data: await blobToBase64(blob),
    directory: Directory.Cache,
  });
  await Share.share({ title: fileName, files: [uri] });
}

export const readFileAsBytes = async (f: File) =>
  new Uint8Array(await f.arrayBuffer());

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 ** 2).toFixed(1)} MB`;
}
