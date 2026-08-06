import imageCompression from "browser-image-compression";
import { PDFDocument } from "pdf-lib";
import { loadPdf, renderPage, canvasToBlob, destroyPdf } from "../pdfRender";
import { passwordProtectedError } from "../pdfErrors";

export type CompressMode = "leve" | "media" | "forte";

/** Imagem/foto: presets por modo; saída PNG ou JPG. */
export async function compressImage(
  file: File,
  mode: CompressMode,
  format: "png" | "jpg",
): Promise<Blob> {
  const presets = {
    leve: { maxWidthOrHeight: 2560, initialQuality: 0.85 },
    media: { maxWidthOrHeight: 1920, initialQuality: 0.7 },
    forte: { maxWidthOrHeight: 1280, initialQuality: 0.5 },
  }[mode];
  return imageCompression(file, {
    ...presets,
    useWebWorker: true,
    fileType: format === "png" ? "image/png" : "image/jpeg",
  });
}

/** PDF leve: re-save com object streams (mantém texto selecionável). */
export async function compressPdfLight(bytes: Uint8Array): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  // PDF cifrado: o re-save do pdf-lib sairia corrompido (streams cifrados sem
  // o /Encrypt) — falha cedo com o erro de senha padronizado
  if (doc.isEncrypted) throw passwordProtectedError();
  return doc.save({ useObjectStreams: true });
}

/** PDF média/forte: re-renderiza páginas como JPEG (perde texto selecionável). */
export async function compressPdfStrong(
  bytes: Uint8Array,
  mode: Exclude<CompressMode, "leve">,
  onProgress?: (done: number, total: number) => void,
): Promise<Uint8Array> {
  const { scale, quality } = mode === "media"
    ? { scale: 1.5, quality: 0.7 }
    : { scale: 1.0, quality: 0.5 };
  const src = await loadPdf(bytes);
  try {
    const out = await PDFDocument.create();
    for (let p = 1; p <= src.numPages; p++) {
      const canvas = await renderPage(src, p, scale);
      const jpg = await canvasToBlob(canvas, "image/jpeg", quality);
      const img = await out.embedJpg(new Uint8Array(await jpg.arrayBuffer()));
      const page = out.addPage([img.width / scale, img.height / scale]);
      page.drawImage(img, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
      onProgress?.(p, src.numPages);
    }
    return out.save({ useObjectStreams: true });
  } finally {
    await destroyPdf(src);
  }
}
