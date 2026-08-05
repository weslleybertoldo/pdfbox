import html2canvas from "html2canvas";
import { PDFDocument } from "pdf-lib";
import { canvasToBlob } from "../pdfRender";

const PAGE_W = 794; // A4 @96dpi
const PAGE_H = 1123;

/** Renderiza um HTML (string) offscreen e fatia em canvases de página A4. */
export async function htmlToPageCanvases(html: string): Promise<HTMLCanvasElement[]> {
  const host = document.createElement("div");
  host.style.cssText = `position:fixed;left:-10000px;top:0;width:${PAGE_W}px;background:#fff;color:#000;`;
  // offline: remove scripts e refs externas
  host.innerHTML = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/(src|href)=["']https?:[^"']*["']/gi, "");
  document.body.appendChild(host);
  try {
    const full = await html2canvas(host, { scale: 2, backgroundColor: "#ffffff" });
    const pages: HTMLCanvasElement[] = [];
    const pageHpx = PAGE_H * 2; // scale 2
    for (let y = 0; y < full.height; y += pageHpx) {
      const c = document.createElement("canvas");
      c.width = full.width;
      c.height = Math.min(pageHpx, full.height - y);
      c.getContext("2d")!.drawImage(full, 0, y, c.width, c.height, 0, 0, c.width, c.height);
      pages.push(c);
    }
    return pages;
  } finally {
    host.remove();
  }
}

/** Canvases → PDF (cada canvas vira página JPEG dentro do PDF). */
export async function canvasesToPdf(canvases: HTMLCanvasElement[]): Promise<Uint8Array> {
  if (canvases.length === 0) throw new Error("nada para converter");
  const doc = await PDFDocument.create();
  for (const c of canvases) {
    const jpg = await canvasToBlob(c, "image/jpeg", 0.9);
    const img = await doc.embedJpg(new Uint8Array(await jpg.arrayBuffer()));
    // página A4 em pontos (595x842), imagem ocupa a largura
    const page = doc.addPage([595, 842]);
    const h = (img.height / img.width) * 595;
    page.drawImage(img, { x: 0, y: 842 - h, width: 595, height: h });
  }
  return doc.save();
}

export async function canvasesToImages(
  canvases: HTMLCanvasElement[],
  baseName: string,
  format: "png" | "jpg",
): Promise<{ blob: Blob; name: string }[]> {
  if (canvases.length === 0) throw new Error("nada para converter");
  const out = [];
  for (const [i, c] of canvases.entries())
    out.push({
      blob: await canvasToBlob(c, format === "png" ? "image/png" : "image/jpeg", 0.9),
      name: `${baseName}-p${i + 1}.${format}`,
    });
  return out;
}
