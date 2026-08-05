import {
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  TextRun,
} from "docx";

/**
 * DOM editado (contentEditable do viewer de Word) → .docx via lib `docx`.
 * Mapeia o essencial — p/div, h1–h6, ul/ol>li, strong/b, em/i, br e <img>
 * com data: URI — e degrada o resto pra texto simples (aceito na spec).
 */

type ImgType = "png" | "jpg" | "gif" | "bmp";

/** Puro: tipo+bytes de um data: URI de imagem suportado pelo docx; senão null. */
export function parseDataUrl(src: string): { type: ImgType; bytes: Uint8Array } | null {
  const m = /^data:image\/(png|jpe?g|gif|bmp);base64,([A-Za-z0-9+/=\s]*)$/i.exec(src.trim());
  if (!m) return null;
  const raw = m[1].toLowerCase();
  const type: ImgType = raw.startsWith("jp") ? "jpg" : (raw as ImgType);
  try {
    const bin = atob(m[2].replace(/\s+/g, ""));
    if (!bin.length) return null;
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { type, bytes };
  } catch {
    return null;
  }
}

/** Puro: encaixa (w,h) na largura máxima mantendo a proporção; mínimo 1×1. */
export function fitWidth(w: number, h: number, maxW: number): { width: number; height: number } {
  if (w <= 0 || h <= 0) return { width: 1, height: 1 };
  const scale = Math.min(1, maxW / w);
  return { width: Math.round(w * scale), height: Math.round(h * scale) };
}

const MAX_IMG_W = 600; // pontos úteis dentro do A4 (mesmo teto do pdfToDocx)

const HEADINGS: Record<string, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
  H1: HeadingLevel.HEADING_1,
  H2: HeadingLevel.HEADING_2,
  H3: HeadingLevel.HEADING_3,
  H4: HeadingLevel.HEADING_4,
  H5: HeadingLevel.HEADING_5,
  H6: HeadingLevel.HEADING_6,
};

/** Tags que quebram o fluxo inline (viram/contêm parágrafos próprios). */
const BLOCK_TAGS = new Set([
  "P", "DIV", "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "LI",
  "TABLE", "THEAD", "TBODY", "TFOOT", "TR", "TD", "TH", "BLOCKQUOTE",
  "SECTION", "ARTICLE", "HEADER", "FOOTER", "MAIN", "FIGURE", "PRE", "HR",
]);

interface Style {
  bold: boolean;
  italics: boolean;
}

/** Conteúdo inline acumulado de um parágrafo em construção. */
interface Inline {
  runs: (TextRun | ImageRun)[];
  text: string; // texto puro (pra descartar parágrafo implícito só de whitespace)
  media: boolean; // tem imagem ou <br> (conta como conteúdo mesmo sem texto)
}

const newInline = (): Inline => ({ runs: [], text: "", media: false });
const PLAIN: Style = { bold: false, italics: false };

/** Estilo efetivo do elemento: tag semântica OU style inline do execCommand. */
function styleOf(el: HTMLElement, base: Style): Style {
  const tag = el.tagName;
  const fw = el.style?.fontWeight ?? "";
  const fs = el.style?.fontStyle ?? "";
  return {
    bold: base.bold || tag === "STRONG" || tag === "B" || fw === "bold" || Number(fw) >= 600,
    italics: base.italics || tag === "EM" || tag === "I" || fs === "italic",
  };
}

/** Acumula UM nó inline (texto, br, img ou elemento de estilo) em `acc`. */
function collectNode(node: Node, style: Style, acc: Inline): void {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = (node.textContent ?? "").replace(/\s+/g, " ");
    if (text) {
      acc.runs.push(new TextRun({ text, bold: style.bold, italics: style.italics }));
      acc.text += text;
    }
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const el = node as HTMLElement;
  if (el.tagName === "BR") {
    acc.runs.push(new TextRun({ break: 1 }));
    acc.media = true;
    return;
  }
  if (el.tagName === "IMG") {
    const img = parseDataUrl(el.getAttribute("src") ?? "");
    if (!img) return; // sem data: URI embutido → sem imagem (nunca rede)
    const w = (el as HTMLImageElement).naturalWidth || Number(el.getAttribute("width")) || 300;
    const h = (el as HTMLImageElement).naturalHeight || Number(el.getAttribute("height")) || 200;
    acc.runs.push(
      new ImageRun({ data: img.bytes, transformation: fitWidth(w, h, MAX_IMG_W), type: img.type }),
    );
    acc.media = true;
    return;
  }
  // inline (span/a/u/code/…): herda/acumula estilo e desce nos filhos
  const s = styleOf(el, style);
  for (const child of Array.from(el.childNodes)) collectNode(child, s, acc);
}

/** Conteúdo inline de todos os filhos de um bloco. */
function collectChildren(el: HTMLElement): Inline {
  const acc = newInline();
  for (const child of Array.from(el.childNodes)) collectNode(child, PLAIN, acc);
  return acc;
}

const hasSubstance = (acc: Inline) => /\S/.test(acc.text) || acc.media;

/**
 * Caminha os blocos: texto/inlines soltos entre blocos viram um parágrafo
 * implícito; blocos conhecidos viram Paragraph com heading/bullet.
 */
function walkBlocks(el: HTMLElement, out: Paragraph[], listLevel: number): void {
  let pending = newInline();
  const flush = () => {
    if (hasSubstance(pending)) out.push(new Paragraph({ children: pending.runs }));
    pending = newInline();
  };

  for (const child of Array.from(el.childNodes)) {
    const tag = child.nodeType === Node.ELEMENT_NODE ? (child as HTMLElement).tagName : "";
    if (!BLOCK_TAGS.has(tag)) {
      collectNode(child, PLAIN, pending);
      continue;
    }
    flush();
    const block = child as HTMLElement;
    if (tag === "UL" || tag === "OL") {
      for (const li of Array.from(block.children)) {
        if (li.tagName === "LI") walkListItem(li as HTMLElement, out, listLevel);
      }
    } else if (tag === "LI") {
      walkListItem(block, out, listLevel);
    } else if (tag in HEADINGS) {
      const acc = collectChildren(block);
      out.push(new Paragraph({ children: acc.runs, heading: HEADINGS[tag] }));
    } else if (tag === "P" || tag === "BLOCKQUOTE" || tag === "PRE" || tag === "FIGURE") {
      // parágrafo explícito entra mesmo vazio (linha em branco intencional)
      out.push(new Paragraph({ children: collectChildren(block).runs }));
    } else if (tag === "HR") {
      out.push(new Paragraph({}));
    } else {
      // container (div/section/table/tr/td/…) → recursão; conteúdo vira parágrafos
      walkBlocks(block, out, listLevel);
    }
  }
  flush();
}

/** <li>: inlines viram um parágrafo com bullet; sublistas descem um nível. */
function walkListItem(li: HTMLElement, out: Paragraph[], level: number): void {
  const acc = newInline();
  const sublists: HTMLElement[] = [];
  for (const child of Array.from(li.childNodes)) {
    const tag = child.nodeType === Node.ELEMENT_NODE ? (child as HTMLElement).tagName : "";
    if (tag === "UL" || tag === "OL") sublists.push(child as HTMLElement);
    else collectNode(child, PLAIN, acc);
  }
  if (hasSubstance(acc)) {
    out.push(new Paragraph({ children: acc.runs, bullet: { level: Math.min(level, 8) } }));
  }
  for (const sub of sublists) {
    for (const subLi of Array.from(sub.children)) {
      if (subLi.tagName === "LI") walkListItem(subLi as HTMLElement, out, level + 1);
    }
  }
}

/** DOM editado → Blob .docx. Formatação não mapeada degrada pra texto (aceito). */
export async function editedDomToDocx(root: HTMLElement): Promise<Blob> {
  const children: Paragraph[] = [];
  walkBlocks(root, children, 0);
  if (children.length === 0) children.push(new Paragraph({}));
  return Packer.toBlob(new Document({ sections: [{ children }] }));
}
