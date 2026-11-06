/**
 * Recuo de tabela do Word antigo. O patch do docx-preview põe o w:tblInd como
 * margin-inline-start da tabela, que é a regra do Word 2013+ (compatibilityMode
 * 15): o recuo marca a BORDA esquerda. No Word 2010 e anteriores (modo < 15, e
 * também o arquivo que não diz o modo) o recuo de uma tabela de primeiro nível
 * marca o TEXTO da 1ª célula: a borda fica à esquerda disso, na margem da célula
 * (5,4 pt no padrão), e a tabela "pendura" pra fora da margem da página. Tabela
 * dentro de célula segue a regra nova nos dois modos. É a mesma regra do
 * OnlyOffice e do LibreOffice (tdf#106742). Caso real (06/11/2026): no formulário
 * FUNDESP convertido do .doc (modo 11) as 7 tabelas saíam 5,4 pt à direita.
 */
type Lado = "Top" | "Bottom";

/** Espessura (pt) da borda da célula naquele lado: a do arquivo (pt) ou, sem ela, a calculada. */
function bordaPt(c: HTMLElement, lado: Lado): number {
  const cs = c.ownerDocument.defaultView?.getComputedStyle(c);
  const estilo = cs?.[`border${lado}Style`];
  if (!cs || !estilo || estilo === "none" || estilo === "hidden") return 0;
  const m = /^(\d*\.?\d+)pt$/.exec(c.style[`border${lado}Width`]);
  return m ? parseFloat(m[1]) : (parseFloat(cs[`border${lado}Width`]) || 0) * 0.75;
}

/**
 * Altura da linha da tabela (w:trHeight): no Word ela vale ENTRE as bordas, e
 * metade da borda de cima e metade da de baixo somam por fora (medido no
 * OnlyOffice: +0,5 pt na linha de borda fina, ~+1 pt nas duplas). No CSS
 * (border-collapse) a altura da <tr> já inclui essas metades, então cada linha
 * saía mais baixa e o fim da página subia: no formulário preenchido, ~10 pt na
 * última tabela, e a linha "Tipo da viagem" encostava na caixa "Viagem" (que é
 * presa na página e não sobe junto).
 */
export function addRowBorders(root: ParentNode): number {
  let n = 0;
  for (const tr of Array.from(root.querySelectorAll<HTMLTableRowElement>("tr"))) {
    const h = /^(\d*\.?\d+)pt$/.exec(tr.style.height);
    if (!h) continue;
    let top = 0;
    let bottom = 0;
    for (const c of Array.from(tr.cells)) {
      top = Math.max(top, bordaPt(c, "Top"));
      bottom = Math.max(bottom, bordaPt(c, "Bottom"));
    }
    const extra = (top + bottom) / 2;
    if (extra <= 0) continue;
    tr.style.height = `${(parseFloat(h[1]) + extra).toFixed(2)}pt`;
    n++;
  }
  return n;
}

export function hangOldTables(root: ParentNode): number {
  let n = 0;
  for (const table of Array.from(root.querySelectorAll<HTMLTableElement>("table"))) {
    if (table.parentElement?.closest("td, th")) continue; // aninhada: o recuo já é da borda
    if (table.style.marginLeft === "auto" || table.style.marginRight === "auto") continue; // centro/direita
    const win = table.ownerDocument.defaultView;
    const cell = table.rows[0]?.cells[0];
    if (!win || !cell) continue;
    const cs = win.getComputedStyle(table);
    if (cs.float !== "none" || cs.position === "absolute" || cs.position === "fixed") continue;
    const pad = parseFloat(win.getComputedStyle(cell).paddingInlineStart) || 0;
    if (!pad) continue;
    const atual = parseFloat(cs.direction === "rtl" ? cs.marginRight : cs.marginLeft) || 0;
    table.style.marginInlineStart = `${atual - pad}px`;
    n++;
  }
  return n;
}
