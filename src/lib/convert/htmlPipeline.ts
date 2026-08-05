import html2canvas from "html2canvas";
import { PDFDocument } from "pdf-lib";
import { canvasToBlob } from "../pdfRender";

const PAGE_W = 794; // A4 @96dpi
const PAGE_H = 1123;
const SCALE = 2;

/** Uma página A4 já rasterizada e comprimida (JPEG/PNG). */
export interface PageImage {
  blob: Blob;
  width: number;
  height: number;
}

/** CSP injetada no <head> do iframe sandbox: nada de rede (só data:/blob: e CSS inline). */
const CSP_META =
  `<meta http-equiv="Content-Security-Policy" ` +
  `content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:">`;

/**
 * Strip de refs externas + script via regex, ANTES do parse (defesa em
 * profundidade; a CSP acima e o sweep DOM abaixo são as outras camadas). O
 * regex é o que impede até a INTENÇÃO de request no parse do doc.write —
 * <link>/<meta>/<base> caem inteiros porque dns-prefetch/preconnect e meta
 * refresh não são governados por CSP.
 *
 * Exportada: o viewer de Word injeta o HTML do mammoth no DOM PRINCIPAL
 * (contentEditable, sem iframe sandbox), então além das refs externas os
 * handlers on*= e URLs javascript: precisam cair aqui — na WebView do
 * Capacitor, script na origem do app alcança a bridge nativa.
 */
export function sanitizeHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<(link|meta|base)\b[^>]*>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, " ")
    .replace(/(src|href|poster|background|data)\s*=\s*["']\s*javascript:[^"']*["']/gi, "")
    .replace(/(src|href|poster|background|data)\s*=\s*["'](?:https?:)?\/\/[^"']*["']/gi, "")
    .replace(/\b(?:image)?srcset\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/url\(\s*(?:https?:)?\/\/[^)]*\)/gi, "none")
    .replace(/@import[^;]*;?/gi, "");
}

/** URL segura para renderização offline: só recursos embutidos (nunca rede/app origin). */
const isInlineUrl = (u: string) => /^\s*(data:|blob:|about:|#|$)/i.test(u);

/** Remove url(...) não embutidas de um trecho de CSS e qualquer @import. */
const stripCssUrls = (css: string) =>
  css
    .replace(/@import[^;]*;?/gi, "")
    .replace(/url\(\s*(["']?)(?![\s"']*(?:data:|blob:|#))[^)]*\)/gi, "none");

/**
 * Sweep DOM: depois do parse (com a CSP já bloqueando os loads), remove dos
 * elementos qualquer referência não embutida. Necessário porque o html2canvas
 * recarrega imagens via `new Image()` no contexto do APP (fora do iframe
 * sandbox), onde a CSP do iframe não vale — sem este sweep, um src externo
 * que escapasse do regex sairia pela rede na hora do snapshot.
 */
function stripExternalRefs(doc: Document): void {
  const URL_ATTRS = ["src", "href", "xlink:href", "poster", "background", "data"];
  for (const el of Array.from(doc.querySelectorAll("*"))) {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name === "srcset" || name === "imagesrcset") el.removeAttribute(attr.name);
      else if (URL_ATTRS.includes(name) && !isInlineUrl(attr.value)) el.removeAttribute(attr.name);
      else if (name === "style") {
        const clean = stripCssUrls(attr.value);
        if (clean !== attr.value) el.setAttribute("style", clean);
      }
    }
    if (el.tagName === "STYLE" && el.textContent) el.textContent = stripCssUrls(el.textContent);
  }
}

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
 * Renderiza um HTML (string) offscreen e devolve as páginas A4 já como
 * imagens comprimidas (JPEG/PNG), UMA POR VEZ — cada página é um html2canvas
 * com crop (x/y/width/height + windowW/H), então nunca existe mais de um
 * canvas full-res vivo. O design antigo (1 canvas do doc inteiro + fatiar)
 * estourava o limite de altura de canvas do Chrome (65.535px ≈ 29 páginas A4
 * em scale 2) e segurava o documento inteiro descomprimido na RAM.
 *
 * O HTML de entrada é não confiável (pode vir de um arquivo .html/.docx/.xlsx
 * qualquer que o usuário abriu). Ele é escrito num <iframe sandbox="allow-same-origin">
 * — sem "allow-scripts" — então nenhum <script>, atributo on*= ou href/src
 * "javascript:" do documento roda; a WebView do Capacitor tem acesso à bridge
 * nativa, então script arbitrário rodando na origem do app é um risco real,
 * não só um XSS comum. Contra vazamento de REDE são 3 camadas: CSP no <head>
 * do iframe (bloqueia loads no parse), sweep DOM stripExternalRefs (o
 * html2canvas recarrega imagens FORA do iframe) e o strip por regex.
 */
export async function htmlToPageImages(
  html: string,
  format: "png" | "jpg" = "jpg",
): Promise<PageImage[]> {
  const sanitized = sanitizeHtml(html);

  const iframe = document.createElement("iframe");
  iframe.setAttribute("sandbox", "allow-same-origin");
  iframe.style.cssText = `position:fixed;left:-10000px;top:0;width:${PAGE_W}px;height:${PAGE_H}px;border:0;`;
  document.body.appendChild(iframe);
  try {
    const doc = iframe.contentDocument;
    if (!doc) throw new Error("não foi possível preparar o sandbox de renderização");
    doc.open();
    doc.write(
      `<!doctype html><html><head>${CSP_META}<style>html,body{margin:0;background:#fff;color:#000;width:${PAGE_W}px}</style></head><body>${sanitized}</body></html>`,
    );
    doc.close();
    stripExternalRefs(doc);
    await waitForImages(doc);

    const totalH = Math.max(PAGE_H, doc.body.scrollHeight);
    const numPages = Math.ceil(totalH / PAGE_H);
    const mime = format === "png" ? "image/png" : "image/jpeg";
    const pages: PageImage[] = [];
    for (let i = 0; i < numPages; i++) {
      const y = i * PAGE_H;
      const canvas = await html2canvas(doc.body, {
        scale: SCALE,
        backgroundColor: "#ffffff",
        x: 0,
        y,
        width: PAGE_W,
        height: Math.min(PAGE_H, totalH - y),
        windowWidth: PAGE_W,
        windowHeight: PAGE_H,
      });
      const { width, height } = canvas;
      const blob = await canvasToBlob(canvas, mime, 0.9);
      // zera o canvas pra liberar o backing store imediatamente
      canvas.width = 0;
      canvas.height = 0;
      pages.push({ blob, width, height });
    }
    return pages;
  } finally {
    iframe.remove();
  }
}

/** Páginas rasterizadas → PDF (cada imagem vira uma página A4). */
export async function pageImagesToPdf(pages: PageImage[]): Promise<Uint8Array> {
  if (pages.length === 0) throw new Error("nenhuma página para converter");
  const doc = await PDFDocument.create();
  for (const p of pages) {
    const bytes = new Uint8Array(await p.blob.arrayBuffer());
    const img =
      p.blob.type === "image/png" ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
    // página A4 em pontos (595x842), imagem ocupa a largura
    const page = doc.addPage([595, 842]);
    const h = (img.height / img.width) * 595;
    page.drawImage(img, { x: 0, y: 842 - h, width: 595, height: h });
  }
  return doc.save();
}

/** Páginas rasterizadas → arquivos de imagem nomeados (1 por página). */
export function pageImagesToFiles(
  pages: PageImage[],
  baseName: string,
  format: "png" | "jpg",
): { blob: Blob; name: string }[] {
  if (pages.length === 0) throw new Error("nenhuma página para converter");
  return pages.map((p, i) => ({ blob: p.blob, name: `${baseName}-p${i + 1}.${format}` }));
}
