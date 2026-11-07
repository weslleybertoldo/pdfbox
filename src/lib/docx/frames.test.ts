import { describe, it, expect } from "vitest";
import { alignFramedParagraphs, FRAME_MARK } from "./frames";

const QUADRO = '<w:framePr w:xAlign="right" w:y="1" w:wrap="around" w:hAnchor="margin" w:vAnchor="text"/>';

describe("alignFramedParagraphs (nº de página em quadro)", () => {
  it("quadro à direita: alinha à direita e marca pro float", () => {
    const xml = `<w:p><w:pPr><w:pStyle w:val="Rodape"/>${QUADRO}</w:pPr><w:r><w:t>1</w:t></w:r></w:p>`;
    const out = alignFramedParagraphs(xml);
    expect(out).toContain(`${QUADRO}<w:jc w:val="right"/>`);
    expect(out).toContain(`w:name="${FRAME_MARK}right"`);
    expect(out.indexOf("<w:bookmarkStart")).toBeGreaterThan(out.indexOf("</w:pPr>"));
    expect(out).toContain("<w:r><w:t>1</w:t></w:r>");
  });
  it("centro: alinha ao centro (sem float)", () => {
    const xml = '<w:p><w:pPr><w:framePr w:xAlign="center" w:wrap="around"/></w:pPr></w:p>';
    const out = alignFramedParagraphs(xml);
    expect(out).toContain('<w:jc w:val="center"/>');
    expect(out).toContain(`${FRAME_MARK}center`);
  });
  it("mantém o alinhamento que o parágrafo já tem", () => {
    const xml = `<w:p><w:pPr>${QUADRO}<w:jc w:val="left"/></w:pPr></w:p>`;
    const out = alignFramedParagraphs(xml);
    expect(out.match(/<w:jc /g)).toHaveLength(1);
  });
  it("ids das marcas não se repetem", () => {
    const p = `<w:p><w:pPr>${QUADRO}</w:pPr></w:p>`;
    const ids = alignFramedParagraphs(p + p).match(/w:bookmarkStart w:id="(\d+)"/g)!;
    expect(new Set(ids).size).toBe(2);
  });
  it("não mexe em quadro com posição absoluta nem em parágrafo comum", () => {
    const abs = '<w:p><w:pPr><w:framePr w:x="1200" w:y="300"/></w:pPr></w:p>';
    const comum = '<w:p><w:pPr><w:spacing w:after="0"/></w:pPr></w:p>';
    expect(alignFramedParagraphs(abs)).toBe(abs);
    expect(alignFramedParagraphs(comum)).toBe(comum);
  });
});
