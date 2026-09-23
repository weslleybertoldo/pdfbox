/**
 * Justificado do Word 2013+ (compatibilityMode ≥ 15): numa linha justificada o
 * Word encolhe os espaços em até 20% pra caber mais uma palavra — o
 * LibreOffice 24.2 faz igual. No CSS o espaço só estica; aqui cada run dos
 * parágrafos justificados ganha word-spacing = −20% da largura do espaço da
 * fonte dela: a quebra de linha conta o espaço encolhido e o justify estica de
 * volta o que sobra. Ex.: ofício da FABd — "ano,sendo" cabe na 3ª linha
 * (23/09/2026). Documento de Word mais antigo (ou sem compatSetting) fica como
 * está.
 */
export const SHRINK = 0.2;

/** compatibilityMode do settings.xml (0 = o arquivo não diz). */
export function compatMode(settingsXml: string): number {
  for (const m of settingsXml.matchAll(/<w:compatSetting\b[^>]*>/g)) {
    if (!/w:name="compatibilityMode"/.test(m[0])) continue;
    const v = /w:val="(\d+)"/.exec(m[0]);
    return v ? parseInt(v[1], 10) : 0;
  }
  return 0;
}

/**
 * Encolhe os espaços dos parágrafos justificados sob root (fontes já
 * carregadas): mede o espaço de cada fonte num canvas do mesmo documento e
 * escreve tudo depois de ler tudo (uma recálculo de estilo só).
 */
export function shrinkJustifiedSpaces(root: HTMLElement): void {
  const doc = root.ownerDocument;
  const win = doc.defaultView;
  const ctx = doc.createElement("canvas").getContext("2d");
  if (!win || !ctx) return;
  const spaceOf = new Map<string, number>();
  const writes: [HTMLElement, string][] = [];
  for (const p of Array.from(root.querySelectorAll<HTMLElement>("p"))) {
    if (win.getComputedStyle(p).textAlign !== "justify") continue;
    for (const el of [p, ...Array.from(p.querySelectorAll<HTMLElement>("span"))]) {
      const cs = win.getComputedStyle(el);
      const font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      let w = spaceOf.get(font);
      if (w === undefined) {
        ctx.font = font;
        w = ctx.measureText(" ").width;
        spaceOf.set(font, w);
      }
      writes.push([el, `${(-SHRINK * w).toFixed(3)}px`]);
    }
  }
  for (const [el, ws] of writes) el.style.wordSpacing = ws;
}
