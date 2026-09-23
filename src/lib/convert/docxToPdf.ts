import mammoth from "mammoth/mammoth.browser";
import html2canvas from "html2canvas";
import { canvasToBlob } from "../pdfRender";
import { prepareDocx, renderPaginated, DOCX_CLASS } from "../docx/render";
import { cssLengthToPx } from "../docx/paginateCore";
import { ensureDocxStyles, loadDocxFonts } from "../docx/fonts";
import { pageImagesToPdf, pageImagesToFiles, type PageImage } from "./htmlPipeline";

/** HTML simples do Word (mammoth) — só pro EDITOR (a entrega 2 troca isto). */
export async function docxToHtml(file: File): Promise<string> {
  const { value } = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
  return `<div style="font-family:serif;font-size:16px;line-height:1.5;padding:40px">${value}</div>`;
}

const SCALE = 2;
/** Nada de rede dentro do iframe: só data:/blob: e as fontes do próprio app. */
const FRAME_CSP =
  `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; ` +
  `img-src data: blob:; style-src 'unsafe-inline'; font-src 'self' data: blob:">`;

/**
 * Word → imagens de página, fiel ao arquivo: mesmo render + mesma paginação da
 * tela, num iframe isolado (sandbox sem scripts). Captura UMA página por vez no
 * DOM do iframe — o html2canvas clona o documento inteiro a cada chamada, então
 * com todas as páginas lá o custo seria quadrático. Página que transbordou
 * (bloco sem ponto de corte) é fatiada na altura nominal, último recurso.
 */
async function docxToPageImages(
  file: File,
  format: "png" | "jpg",
  onProgress?: (pct: number) => void,
): Promise<PageImage[]> {
  const prepared = await prepareDocx(new Uint8Array(await file.arrayBuffer()));
  // o html2canvas desenha num <canvas> do documento PRINCIPAL, e o texto do
  // canvas usa as fontes DESSE documento: sem isto ele posiciona as palavras
  // com a métrica da Tinos (medida no iframe) e pinta com a fonte do sistema,
  // e as palavras se sobrepõem
  ensureDocxStyles(document);
  await loadDocxFonts(document, prepared.families);
  const iframe = document.createElement("iframe");
  iframe.setAttribute("sandbox", "allow-same-origin");
  iframe.style.cssText = "position:fixed;left:-10000px;top:0;width:1600px;height:2400px;border:0;";
  document.body.appendChild(iframe);
  try {
    const doc = iframe.contentDocument;
    const win = iframe.contentWindow;
    if (!doc || !win) throw new Error("não foi possível preparar o sandbox de renderização");
    doc.open();
    doc.write(
      `<!doctype html><html><head>${FRAME_CSP}<style>html,body{margin:0;background:#fff}</style></head>` +
        `<body><div id="s"></div><div id="p"></div></body></html>`,
    );
    doc.close();
    const stylesEl = doc.getElementById("s")!;
    const pagesEl = doc.getElementById("p")!;
    await renderPaginated(prepared, pagesEl, stylesEl);
    const pages = Array.from(pagesEl.querySelectorAll<HTMLElement>(`section.${DOCX_CLASS}`));
    pages.forEach((pg) => pg.remove());
    const mime = format === "png" ? "image/png" : "image/jpeg";
    const out: PageImage[] = [];
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      pagesEl.appendChild(page);
      const w = page.offsetWidth;
      const fullH = page.offsetHeight;
      const nominalH = cssLengthToPx(page.style.minHeight) || fullH;
      const rect = page.getBoundingClientRect();
      for (let y = 0; y < fullH - 1; y += nominalH) {
        const canvas = await html2canvas(page, {
          scale: SCALE,
          backgroundColor: "#ffffff",
          logging: false,
          x: rect.left + win.scrollX,
          y: rect.top + win.scrollY + y,
          width: w,
          height: Math.min(nominalH, fullH - y),
          windowWidth: 1600,
          windowHeight: 2400,
        });
        const blob = await canvasToBlob(canvas, mime, 0.9);
        out.push({
          blob,
          width: canvas.width,
          height: canvas.height,
          pageWidthPt: w * 0.75,
          pageHeightPt: nominalH * 0.75,
        });
        // zera o canvas pra liberar o backing store imediatamente
        canvas.width = 0;
        canvas.height = 0;
      }
      page.remove();
      onProgress?.(((i + 1) / pages.length) * 100);
    }
    return out;
  } finally {
    iframe.remove();
  }
}

export const docxToPdf = async (f: File, onProgress?: (pct: number) => void) =>
  pageImagesToPdf(await docxToPageImages(f, "jpg", onProgress));

export const docxToImages = async (
  f: File,
  base: string,
  fmt: "png" | "jpg",
  onProgress?: (pct: number) => void,
) => pageImagesToFiles(await docxToPageImages(f, fmt, onProgress), base, fmt);
