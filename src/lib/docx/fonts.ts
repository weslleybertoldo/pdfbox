/**
 * Fontes livres com a MESMA métrica das fontes do Word (cada letra tem a mesma
 * largura), embutidas em public/fonts/docx/ (latim, woff2; geradas por
 * scripts/build-docx-fonts.py, licenças em LICENSES.md). Sem elas o Android
 * troca Times New Roman / Calibri pela fonte do sistema, o texto quebra em
 * outros pontos e a página muda (visto no ofício da FABd: o rodapé quebrava a
 * linha do logo).
 */
export const DOCX_FONT_FILES: Record<string, string> = {
  "Times New Roman": "Tinos",
  Arial: "Arimo",
  Helvetica: "Arimo",
  "Courier New": "Cousine",
  Calibri: "PDFBoxSansC", // Carlito renomeado (Reserved Font Name da OFL)
  Cambria: "Caladea",
  Georgia: "Gelasio",
};

const STYLES = [
  { weight: 400, style: "normal", suffix: "Regular" },
  { weight: 700, style: "normal", suffix: "Bold" },
  { weight: 400, style: "italic", suffix: "Italic" },
  { weight: 700, style: "italic", suffix: "BoldItalic" },
] as const;

/** URL absoluta da pasta das fontes, resolvida contra a página do app. */
export const fontsBase = (doc: Pick<Document, "baseURI"> = document): string =>
  new URL("fonts/docx/", doc.baseURI).href;

/** @font-face das famílias embutidas, com os NOMES do Word. */
export function fontFaceCss(base: string): string {
  const rules: string[] = [];
  for (const [family, file] of Object.entries(DOCX_FONT_FILES)) {
    for (const s of STYLES) {
      rules.push(
        `@font-face{font-family:"${family}";font-weight:${s.weight};font-style:${s.style};` +
          `font-display:block;src:url("${base}${file}-${s.suffix}.woff2") format("woff2")}`,
      );
    }
  }
  return rules.join("\n");
}

/**
 * CSS da continuação de parágrafo criada pelo paginador: sem o marcador de
 * lista (::before) e sem contar de novo no contador da numeração.
 */
const PAGINATION_CSS =
  "section.docxv p[data-pg-cont]::before{content:none!important}" +
  "section.docxv p[data-pg-cont]{counter-increment:none!important;counter-reset:none!important}";

/** Injeta @font-face + CSS da paginação no documento (1× por documento). */
export function ensureDocxStyles(doc: Document, base: string = fontsBase()): void {
  if (doc.head.querySelector("style[data-docx-fonts]")) return;
  const style = doc.createElement("style");
  style.setAttribute("data-docx-fonts", "");
  style.textContent = `${fontFaceCss(base)}\n${PAGINATION_CSS}`;
  doc.head.appendChild(style);
}

/** Famílias embutidas citadas nos XMLs do .docx (fontTable, estilos, tema, corpo). */
export function familiesIn(xmls: string[]): string[] {
  const all = xmls.join("\n");
  return Object.keys(DOCX_FONT_FILES).filter((f) => all.includes(`"${f}"`));
}

/** Carrega as 4 variações das famílias usadas ANTES de medir o layout. */
export async function loadDocxFonts(doc: Document, families: string[]): Promise<void> {
  const fonts = doc.fonts;
  if (!fonts) return;
  await Promise.all(
    families.flatMap((f) =>
      STYLES.map((s) => fonts.load(`${s.style} ${s.weight} 16px "${f}"`).catch(() => [])),
    ),
  );
  await fonts.ready;
}
