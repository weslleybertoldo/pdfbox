import { beforeAll, describe, expect, it } from "vitest";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { EMPTY_LINE, fillEmptyParagraphs } from "./emptyParagraphs";

// ambiente node: o módulo usa DOMParser/XMLSerializer globais (no app, os do browser)
beforeAll(() => {
  Object.assign(globalThis, { DOMParser, XMLSerializer });
});

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const body = (ps: string) => `<?xml version="1.0"?><w:document ${W}><w:body>${ps}</w:body></w:document>`;
const MARK = '<w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="24"/><w:ins w:id="1" w:author="x"/></w:rPr>';

describe("fillEmptyParagraphs", () => {
  it("linha em branco do ofício ganha uma run com a fonte da marca de parágrafo e o espaço de largura zero", () => {
    const out = fillEmptyParagraphs(body(`<w:p><w:pPr>${MARK}</w:pPr><w:r><w:rPr><w:rtl w:val="0"/></w:rPr></w:r></w:p>`));
    const doc = new DOMParser().parseFromString(out, "application/xml");
    const runs = doc.getElementsByTagName("w:r");
    expect(runs.length).toBe(2);
    const nova = runs[1];
    expect(nova.getElementsByTagName("w:t")[0].textContent).toBe(EMPTY_LINE);
    expect(nova.getElementsByTagName("w:sz")[0].getAttribute("w:val")).toBe("24");
    expect(nova.getElementsByTagName("w:rFonts")[0].getAttribute("w:ascii")).toBe("Times New Roman");
    expect(nova.getElementsByTagName("w:ins").length).toBe(0); // revisão da marca não vai pra run
    expect(doc.getElementsByTagName("w:pPr")[0].getElementsByTagName("w:ins").length).toBe(1);
  });

  it("sem marca formatada: run sem rPr (vale o estilo do parágrafo)", () => {
    const out = fillEmptyParagraphs(body("<w:p/>"));
    expect(out).toContain(`<w:r><w:t>${EMPTY_LINE}</w:t></w:r>`);
  });

  it("parágrafo com texto, imagem, quebra ou tabulação fica como está", () => {
    const xml = body(
      "<w:p><w:r><w:t>Senhor(a)</w:t></w:r></w:p>" +
        "<w:p><w:r><w:drawing/></w:r></w:p>" +
        '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' +
        '<w:p><w:pPr><w:tabs><w:tab w:val="center" w:pos="4252"/></w:tabs></w:pPr><w:r><w:tab/></w:r></w:p>',
    );
    expect(fillEmptyParagraphs(xml)).toBe(xml);
    expect(fillEmptyParagraphs("<nada")).toBe("<nada");
  });
});
