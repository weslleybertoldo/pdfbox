import html2canvas from "html2canvas";
import { PDFDocument } from "pdf-lib";
import { canvasToBlob } from "../pdfRender";

const PAGE_W = 794; // A4 @96dpi
const PAGE_H = 1123;

/** Espera imagens locais decodificarem antes do snapshot; nunca trava (timeout curto por imagem). */
async function waitForImages(doc: Document, timeoutMs = 2000): Promise<void> {
  const imgs = Array.from(doc.images).filter((img) => !img.complete);
  await Promise.all(
    imgs.map((img) =>
      Promise.race([
        img.decode().catch(() => undefined),
        new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
      ]),
    ),
  );
}

/**
 * Renderiza um HTML (string) offscreen e fatia em canvases de página A4.
 *
 * O HTML de entrada é não confiável (pode vir de um arquivo .html/.docx/.xlsx
 * qualquer que o usuário abriu). Ele é escrito num <iframe sandbox="allow-same-origin">
 * — sem "allow-scripts" — então nenhum <script>, atributo on*= ou href/src
 * "javascript:" do documento roda; a WebView do Capacitor tem acesso à bridge
 * nativa, então script arbitrário rodando na origem do app é um risco real,
 * não só um XSS comum. O strip de <script>/refs externas abaixo é defesa em
 * profundidade (mantido mesmo com o sandbox como camada primária).
 */
export async function htmlToPageCanvases(html: string): Promise<HTMLCanvasElement[]> {
  const sanitized = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/(src|href)=["']https?:[^"']*["']/gi, "");

  const iframe = document.createElement("iframe");
  iframe.setAttribute("sandbox", "allow-same-origin");
  iframe.style.cssText = `position:fixed;left:-10000px;top:0;width:${PAGE_W}px;height:1px;border:0;`;
  document.body.appendChild(iframe);
  try {
    const doc = iframe.contentDocument;
    if (!doc) throw new Error("não foi possível preparar o sandbox de renderização");
    doc.open();
    doc.write(
      `<!doctype html><html><head><style>html,body{margin:0;background:#fff;color:#000;width:${PAGE_W}px}</style></head><body>${sanitized}</body></html>`,
    );
    doc.close();
    await waitForImages(doc);

    const full = await html2canvas(doc.body, { scale: 2, backgroundColor: "#ffffff" });
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
    iframe.remove();
  }
}

/** Canvases → PDF (cada canvas vira página JPEG dentro do PDF). */
export async function canvasesToPdf(canvases: HTMLCanvasElement[]): Promise<Uint8Array> {
  if (canvases.length === 0) throw new Error("nenhuma página para converter");
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
  if (canvases.length === 0) throw new Error("nenhuma página para converter");
  const out = [];
  for (const [i, c] of canvases.entries())
    out.push({
      blob: await canvasToBlob(c, format === "png" ? "image/png" : "image/jpeg", 0.9),
      name: `${baseName}-p${i + 1}.${format}`,
    });
  return out;
}
