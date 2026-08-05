import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl; // bundle local, sem CDN

export type PdfDoc = pdfjs.PDFDocumentProxy;

/** Carrega um PDF a partir dos bytes; quem carrega, destrói via destroyPdf. */
export const loadPdf = (bytes: Uint8Array): Promise<PdfDoc> =>
  pdfjs.getDocument({ data: bytes }).promise;

/** Libera worker + caches do documento; chamar sempre que terminar de usar o doc. */
export async function destroyPdf(doc: PdfDoc): Promise<void> {
  await doc.loadingTask.destroy();
}

/** Renderiza 1 página num canvas na escala dada. */
export async function renderPage(
  doc: PdfDoc,
  pageNum: number,
  scale: number,
): Promise<HTMLCanvasElement> {
  const page = await doc.getPage(pageNum);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  // `canvas` (não `canvasContext`) é o param aceito nesta versão do pdf.js;
  // internamente ele deriva o contexto 2D do próprio canvas.
  await page.render({ canvas, viewport }).promise;
  return canvas;
}

/** Miniaturas (~140px de largura) para o PageGrid. */
export async function renderThumbnails(doc: PdfDoc): Promise<string[]> {
  const thumbs: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const scale = 140 / page.getViewport({ scale: 1 }).width;
    const canvas = await renderPage(doc, p, scale);
    thumbs.push(canvas.toDataURL("image/jpeg", 0.7));
  }
  return thumbs;
}

export function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: "image/png" | "image/jpeg",
  quality?: number,
): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob falhou"))), type, quality),
  );
}
