/**
 * Entrelinha do Word (w:spacing w:lineRule="auto"): "1,5 linha" = 1,5 × a altura
 * NATURAL da linha da fonte (Times New Roman ≈ 1,15 do corpo), não 1,5 × o
 * corpo. A docx-preview escreve line-height: 1.5 — ~13% mais apertado que o Word
 * e o LibreOffice (ofício da FABd, 23/09/2026: 18 pt × 21 pt no parágrafo). Aqui
 * todo line-height sem unidade (só a regra "auto" gera; exata e "pelo menos"
 * vêm em pt) vira calc(N * var(--docxv-lh)), e cada parágrafo ganha
 * --docxv-lh = altura normal ÷ corpo da fonte do texto dele, medida no próprio
 * documento (fontes já carregadas). O parágrafo também passa a ter a fonte e o
 * corpo do próprio texto: a linha do CSS começa com um "strut" na fonte do <p>
 * (a da interface, 12 pt) e esticava as linhas de corpo menor — rodapé do
 * ofício em 11 pt: 14,2 pt por linha × 12,6 pt no Word. Parágrafo só com
 * imagem: a linha tem a altura da imagem (ou da fonte, se for maior), sem a
 * "descida" da letra embaixo — logo do cabeçalho do ofício: 125,35 pt no app ×
 * 121,65 pt (a imagem) no LibreOffice.
 */
const VAR = "--docxv-lh";
const UNITLESS_CSS = /line-height:\s*(\d*\.?\d+)\s*(?=[;}\r\n])/g;
const UNITLESS = /^\d*\.?\d+$/;

/** line-height sem unidade de um CSS → múltiplo da altura natural da fonte. */
export const scaleLineHeightCss = (css: string): string =>
  css.replace(UNITLESS_CSS, (_, n: string) => `line-height: calc(${n} * var(${VAR}, 1))`);

export function applyWordLineHeights(pagesEl: HTMLElement, stylesEl: HTMLElement): void {
  for (const st of Array.from(stylesEl.querySelectorAll("style"))) {
    const css = st.textContent ?? "";
    const out = scaleLineHeightCss(css);
    if (out !== css) st.textContent = out;
  }
  for (const el of Array.from(pagesEl.querySelectorAll<HTMLElement>("[style*='line-height']"))) {
    const v = el.style.lineHeight;
    if (UNITLESS.test(v)) el.style.lineHeight = `calc(${v} * var(${VAR}, 1))`;
  }
  const doc = pagesEl.ownerDocument;
  const win = doc.defaultView;
  if (!win || !doc.body) return;
  // sonda fora das páginas (não entra na paginação); offsetHeight não sofre o transform do palco
  const probe = doc.createElement("div");
  probe.style.cssText =
    "position:absolute;left:-9999px;top:0;visibility:hidden;font-size:200px;line-height:normal;white-space:nowrap";
  probe.textContent = "Hg";
  doc.body.appendChild(probe);
  const ratioOf = new Map<string, number>();
  const writes: [HTMLElement, string, string | null, string, HTMLElement[]][] = [];
  for (const p of Array.from(pagesEl.querySelectorAll<HTMLElement>("p"))) {
    const spans = Array.from(p.querySelectorAll<HTMLElement>("span"));
    const text = spans.find((s) => s.textContent?.trim());
    const run = text ?? spans[0] ?? p;
    const cs = win.getComputedStyle(run);
    let r = ratioOf.get(cs.fontFamily);
    if (r === undefined) {
      probe.style.fontFamily = cs.fontFamily;
      r = probe.offsetHeight / 200 || 1;
      ratioOf.set(cs.fontFamily, r);
    }
    // caixa inline-block de cada imagem de um parágrafo sem texto (a docx-preview embrulha o <img>)
    const pics = text
      ? []
      : Array.from(p.querySelectorAll("img"))
          .map((img) => img.parentElement)
          .filter((b): b is HTMLElement => !!b && win.getComputedStyle(b).display === "inline-block");
    writes.push([p, r.toFixed(4), run === p ? null : cs.fontSize, cs.fontFamily, pics]);
  }
  probe.remove();
  for (const [p, r, size, family, pics] of writes) {
    p.style.setProperty(VAR, r);
    if (size) {
      p.style.fontSize = size;
      p.style.fontFamily = family;
    }
    for (const b of pics) b.style.verticalAlign = "top";
  }
}
