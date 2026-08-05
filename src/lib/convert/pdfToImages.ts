import { loadPdf, renderPage, canvasToBlob } from "../pdfRender";

export interface ImageOut { blob: Blob; name: string }

/** PDF → 1 imagem por página (PNG ou JPG), escala 2x para nitidez. */
export async function pdfToImages(
  bytes: Uint8Array,
  baseName: string,
  format: "png" | "jpg",
  pages?: number[],                       // ausente = todas
  onProgress?: (done: number, total: number) => void,
): Promise<ImageOut[]> {
  const doc = await loadPdf(bytes);
  const list = pages ?? Array.from({ length: doc.numPages }, (_, i) => i + 1);
  const out: ImageOut[] = [];
  for (const [i, p] of list.entries()) {
    const canvas = await renderPage(doc, p, 2);
    const blob = await canvasToBlob(
      canvas,
      format === "png" ? "image/png" : "image/jpeg",
      format === "jpg" ? 0.9 : undefined,
    );
    out.push({ blob, name: `${baseName}-p${p}.${format}` });
    onProgress?.(i + 1, list.length);
  }
  return out;
}
