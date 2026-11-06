/**
 * Parágrafo em QUADRO (<w:framePr>) alinhado à direita/centro da margem — o
 * jeito clássico do Word antigo pôr o nº da página no canto do rodapé. A
 * docx-preview ignora o framePr: o número ia pra esquerda e, como o quadro
 * flutua por cima do parágrafo seguinte (wrap="around"), ainda subia uma linha.
 *
 * No XML: o quadro alinhado ganha o alinhamento como <w:jc> (se não tiver) e
 * uma marca (bookmark, que a lib desenha como <span id>). No DOM, o parágrafo
 * marcado à direita vira float: o parágrafo seguinte divide a mesma linha, como
 * no Word. Quadro com posição absoluta (w:x, sem xAlign) fica como está.
 */
export const FRAME_MARK = "_pdfboxQuadro_";

const FRAME_ALINHADO = /<w:framePr\b[^>]*\bw:xAlign="(right|center|outside)"[^>]*\/>/;

export function alignFramedParagraphs(xml: string): string {
  if (!xml.includes("<w:framePr")) return xml;
  let id = 900_000;
  return xml.replace(/<w:pPr>([\s\S]*?)<\/w:pPr>/g, (bloco, dentro: string) => {
    const m = FRAME_ALINHADO.exec(dentro);
    if (!m) return bloco;
    const lado = m[1] === "center" ? "center" : "right";
    const pPr = /<w:jc\b/.test(dentro)
      ? dentro
      : dentro.replace(m[0], `${m[0]}<w:jc w:val="${lado}"/>`);
    id++;
    return (
      `<w:pPr>${pPr}</w:pPr>` +
      `<w:bookmarkStart w:id="${id}" w:name="${FRAME_MARK}${lado}"/><w:bookmarkEnd w:id="${id}"/>`
    );
  });
}

/** No DOM: quadro à direita flutua (o parágrafo seguinte divide a linha). */
export function floatFramedParagraphs(root: ParentNode): number {
  let n = 0;
  for (const marca of Array.from(root.querySelectorAll<HTMLElement>(`span[id^="${FRAME_MARK}"]`))) {
    const lado = marca.id.slice(FRAME_MARK.length);
    marca.removeAttribute("id"); // repete em toda página: sem id duplicado
    const p = marca.closest<HTMLElement>("p");
    if (p && lado === "right") {
      p.style.float = "right";
      n++;
    }
  }
  return n;
}
