import * as pdfjs from "pdfjs-dist";
// Asset cru do pdfjs-dist (bundle local, sem CDN). Os polyfills core-js pro
// worker (thread separada) são injetados por CONCATENAÇÃO no build, via
// plugin `pdfWorkerPolyfillPlugin` em vite.config.ts — ver lá o porquê de
// não dar pra usar o `?worker&url` do Vite pra isso (ele descarta o export
// que o pdf.js precisa no fallback "fake worker").
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl; // bundle local, sem CDN

export type PdfDoc = pdfjs.PDFDocumentProxy;

/**
 * Carrega um PDF a partir dos bytes; quem carrega, destrói via destroyPdf.
 * `.slice()` copia pra um ArrayBuffer novo: o pdf.js transfere (detach) o
 * buffer original pro worker, então sem a cópia uma 2ª chamada com os mesmos
 * `bytes` (ex.: usuário tenta comprimir "média" e depois "forte" na mesma
 * tela) quebra com "ArrayBuffer ... already detached".
 */
export const loadPdf = (bytes: Uint8Array): Promise<PdfDoc> =>
  pdfjs.getDocument({ data: bytes.slice() }).promise;

/** Libera worker + caches do documento; chamar sempre que terminar de usar o doc. */
export async function destroyPdf(doc: PdfDoc): Promise<void> {
  await doc.loadingTask.destroy();
}

/** Maior dimensão física permitida por canvas — zoom alto × DPR estoura o
 *  limite de canvas/memória da WebView Android. */
const MAX_CANVAS_DIM = 4096;

/**
 * Renderiza 1 página num canvas na escala dada.
 *
 * `opts.dpr` multiplica só a resolução FÍSICA do canvas (nitidez em telas de
 * alta densidade); o tamanho CSS (style.width/height) fica na escala lógica.
 * Default 1: consumidores que usam o canvas como IMAGEM (pdfToImages,
 * compressPdfStrong, thumbnails) não ganham DPR implícito — mudaria a
 * resolução dos arquivos gerados. O viewer passa window.devicePixelRatio.
 * A escala física total (scale*dpr) é limitada por MAX_CANVAS_DIM.
 */
export async function renderPage(
  doc: PdfDoc,
  pageNum: number,
  scale: number,
  opts?: { dpr?: number },
): Promise<HTMLCanvasElement> {
  const page = await doc.getPage(pageNum);
  const viewport = page.getViewport({ scale }); // tamanho CSS (lógico)
  const physRatio = Math.min(
    opts?.dpr ?? 1,
    MAX_CANVAS_DIM / Math.max(viewport.width, viewport.height),
  );
  const physViewport =
    physRatio === 1 ? viewport : page.getViewport({ scale: scale * physRatio });
  const canvas = document.createElement("canvas");
  canvas.width = physViewport.width;
  canvas.height = physViewport.height;
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;
  // `canvas` (não `canvasContext`) é o param aceito nesta versão do pdf.js;
  // internamente ele deriva o contexto 2D do próprio canvas.
  await page.render({ canvas, viewport: physViewport }).promise;
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
