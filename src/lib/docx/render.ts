import JSZip from "jszip";
import { parseAsync, renderDocument } from "docx-preview";
import { markPageFields } from "./pageFields";
import { ensureDocxStyles, familiesIn, loadDocxFonts } from "./fonts";
import { sanitizeDocxDom } from "./sanitize";
import { paginate, type Chrome, type ChromeFor } from "./paginate";
import { DOCX_CLASS } from "./paginateCore";
import { DEFAULT_TAB_TWIPS, expandTabMarks, layoutTabs, markTabs, readStyleTabs } from "./tabs";
import { compatMode, shrinkJustifiedSpaces } from "./justify";
import { applyWordLineHeights } from "./lineHeight";
import { fillEmptyParagraphs } from "./emptyParagraphs";

export { DOCX_CLASS };

/**
 * Opções da docx-preview. renderAltChunks: o padrão (true) cria <iframe srcdoc>
 * com HTML vindo do arquivo, SEM sandbox, na origem do app (onde está a ponte
 * nativa) — nunca ligar. experimental: false porque o modo experimental
 * recalcula as tabulações 500 ms depois do render e mudaria o layout depois
 * da paginação — quem calcula as tabulações é o tabs.ts, antes de paginar.
 */
export const DOCX_OPTIONS = {
  className: DOCX_CLASS,
  inWrapper: false,
  breakPages: true,
  ignoreLastRenderedPageBreak: true,
  useBase64URL: true,
  renderAltChunks: false,
  renderComments: false,
  renderChanges: false,
  experimental: false,
  renderHeaders: true,
  renderFooters: true,
  renderFootnotes: true,
  renderEndnotes: true,
};

export interface PreparedDocx {
  /** .docx com os campos de página marcados (ou o original, se não tinha) */
  blob: Blob;
  /** famílias embutidas que o arquivo usa (preload antes de medir) */
  families: string[];
  /** 1ª página com cabeçalho próprio / pares e ímpares diferentes; 1 seção só? */
  chrome: { titlePg: boolean; evenOdd: boolean; singleSection: boolean };
  /** Word 2013+ (compatibilityMode ≥ 15): justificado encolhe os espaços (justify.ts) */
  shrinkJustify: boolean;
}

const FIELD_PARTS = /^word\/(document|header\d*|footer\d*)\.xml$/;
const TAB_PARTS = /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/;
const FONT_PARTS = /^word\/(document|styles|fontTable|theme\/theme\d*)\.xml$/;

/** Flag booleana do OOXML presente e não desligada (<w:x/> ou w:val diferente de 0/false). */
const flagOn = (xml: string, tag: string): boolean => {
  const m = new RegExp(`<w:${tag}(\\s[^>]*)?/>`).exec(xml);
  return Boolean(m) && !/w:val="(0|false|off)"/.test(m![0]);
};

/**
 * Prepara o .docx: marca os campos de página e as tabulações, descobre as
 * fontes e valida com o parser da docx-preview. Lança se não for um .docx
 * legível — o viewer só troca de arquivo depois disto (abrir continua atômico).
 */
export async function prepareDocx(bytes: Uint8Array): Promise<PreparedDocx> {
  const zip = await JSZip.loadAsync(bytes);
  const fontXml: string[] = [];
  const parts = new Map<string, string>();
  let documentXml = "";
  let settingsXml = "";
  let stylesXml = "";
  let changed = false;
  for (const name of Object.keys(zip.files)) {
    const entry = zip.file(name);
    if (!entry) continue;
    if (name === "word/settings.xml") settingsXml = await entry.async("string");
    const isPart = TAB_PARTS.test(name);
    const isFont = FONT_PARTS.test(name);
    if (!isPart && !isFont) continue;
    const xml = await entry.async("string");
    if (isFont) fontXml.push(xml);
    if (name === "word/document.xml") documentXml = xml;
    if (name === "word/styles.xml") stylesXml = xml;
    if (isPart) parts.set(name, xml);
  }
  if (!documentXml) throw new Error("arquivo sem corpo de documento");
  // tabulações depois de ler tudo: as paradas vêm também dos estilos
  const styleTabs = readStyleTabs(stylesXml);
  const defTab = /<w:defaultTabStop\s[^>]*w:val="(\d+)"/.exec(settingsXml);
  const defTwips = defTab ? parseInt(defTab[1], 10) : DEFAULT_TAB_TWIPS;
  for (const [name, xml] of parts) {
    const fields = FIELD_PARTS.test(name) ? markPageFields(xml) : xml;
    const marked = fillEmptyParagraphs(markTabs(fields, styleTabs, defTwips));
    if (marked !== xml) {
      zip.file(name, marked);
      changed = true;
    }
  }
  const blob = changed
    ? await zip.generateAsync({ type: "blob", compression: "STORE" })
    : new Blob([bytes.slice()]);
  const wd = await parseAsync(blob, DOCX_OPTIONS);
  if (!(wd as unknown as { documentPart?: { body?: unknown } }).documentPart?.body) {
    throw new Error("arquivo sem corpo de documento");
  }
  return {
    blob,
    families: familiesIn(fontXml),
    chrome: {
      titlePg: flagOn(documentXml, "titlePg"),
      evenOdd: flagOn(settingsXml, "evenAndOddHeaders"),
      singleSection: (documentXml.match(/<w:sectPr[\s>]/g) ?? []).length <= 1,
    },
    shrinkJustify: compatMode(settingsXml) >= 15,
  };
}

/**
 * Renderiza `blob` em pagesEl (section.docxv) e stylesEl (<style> da lib).
 * Parse NOVO a cada render: a docx-preview MUTA o modelo ao quebrar página no
 * meio de um parágrafo (renderizar 2× o mesmo modelo perde texto).
 */
export async function renderDocxInto(
  blob: Blob,
  families: string[],
  pagesEl: HTMLElement,
  stylesEl: HTMLElement,
  shrinkJustify = false,
): Promise<void> {
  const doc = pagesEl.ownerDocument;
  ensureDocxStyles(doc);
  await loadDocxFonts(doc, families);
  const nodes = await renderDocument(await parseAsync(blob, DOCX_OPTIONS), DOCX_OPTIONS);
  stylesEl.replaceChildren();
  pagesEl.replaceChildren();
  for (const n of nodes) (n.nodeName === "STYLE" ? stylesEl : pagesEl).appendChild(n);
  sanitizeDocxDom(stylesEl);
  sanitizeDocxDom(pagesEl);
  expandTabMarks(pagesEl);
  await doc.fonts?.ready;
  applyWordLineHeights(pagesEl, stylesEl);
  if (shrinkJustify) shrinkJustifiedSpaces(pagesEl); // antes das tabulações: muda onde cada uma começa
  layoutTabs(pagesEl);
}

const BR_PAGE = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';

/**
 * Sonda: o mesmo .docx com o corpo trocado por 3 parágrafos vazios separados
 * por quebra de página (e a mesma sectPr). A docx-preview devolve 3 páginas com
 * as 3 variantes de cabeçalho/rodapé: 1ª página, par e ímpar/padrão.
 */
async function probeChrome(
  p: PreparedDocx,
  host: HTMLElement,
): Promise<{ first: Chrome; even: Chrome; odd: Chrome }> {
  const zip = await JSZip.loadAsync(await p.blob.arrayBuffer());
  const xml = await zip.file("word/document.xml")!.async("string");
  const sects = xml.match(/<w:sectPr[\s>][\s\S]*?<\/w:sectPr>/g) ?? [];
  const sect = sects[sects.length - 1] ?? "";
  zip.file(
    "word/document.xml",
    xml.replace(/<w:body>[\s\S]*<\/w:body>/, `<w:body><w:p/>${BR_PAGE}${BR_PAGE}${sect}</w:body>`),
  );
  const blob = await zip.generateAsync({ type: "blob", compression: "STORE" });
  const doc = host.ownerDocument;
  const pagesEl = doc.createElement("div");
  const stylesEl = doc.createElement("div");
  host.append(stylesEl, pagesEl);
  try {
    await renderDocxInto(blob, p.families, pagesEl, stylesEl, p.shrinkJustify);
    const pages = Array.from(pagesEl.querySelectorAll<HTMLElement>(`section.${DOCX_CLASS}`));
    const pick = (s: HTMLElement | undefined): Chrome => ({
      header: (s?.querySelector(":scope > header")?.cloneNode(true) as Element | undefined) ?? null,
      footer: (s?.querySelector(":scope > footer")?.cloneNode(true) as Element | undefined) ?? null,
    });
    return { first: pick(pages[0]), even: pick(pages[1]), odd: pick(pages[2]) };
  } finally {
    stylesEl.remove();
    pagesEl.remove();
  }
}

/**
 * Render completo: docx-preview → (sonda de cabeçalho, se o documento tem 1ª
 * página ou par/ímpar diferentes) → paginação. Devolve o nº de páginas.
 */
export async function renderPaginated(
  p: PreparedDocx,
  pagesEl: HTMLElement,
  stylesEl: HTMLElement,
): Promise<number> {
  await renderDocxInto(p.blob, p.families, pagesEl, stylesEl, p.shrinkJustify);
  let chromeFor: ChromeFor | undefined;
  if (p.chrome.singleSection && (p.chrome.titlePg || p.chrome.evenOdd)) {
    const v = await probeChrome(p, pagesEl.parentElement ?? pagesEl.ownerDocument.body);
    chromeFor = (n) => (n === 1 && p.chrome.titlePg ? v.first : p.chrome.evenOdd && n % 2 === 0 ? v.even : v.odd);
  }
  return paginate(pagesEl, chromeFor);
}
