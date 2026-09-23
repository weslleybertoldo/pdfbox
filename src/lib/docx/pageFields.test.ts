import { beforeAll, describe, expect, it } from "vitest";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { markPageFields, fillPageMarks, PAGE_MARK, NUMPAGES_MARK } from "./pageFields";

// ambiente node: o módulo usa DOMParser/XMLSerializer globais (no app, os do browser)
beforeAll(() => {
  Object.assign(globalThis, { DOMParser, XMLSerializer });
});

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const ftr = (body: string) => `<?xml version="1.0"?><w:ftr ${W}><w:p>${body}</w:p></w:ftr>`;

describe("markPageFields", () => {
  it("campo simples PAGE: desembrulha e troca o resultado pelo marcador", () => {
    const out = markPageFields(
      ftr('<w:fldSimple w:instr=" PAGE \\* MERGEFORMAT "><w:r><w:t>1</w:t></w:r></w:fldSimple>'),
    );
    expect(out).not.toContain("fldSimple");
    expect(out).toContain(`<w:t>${PAGE_MARK}</w:t>`);
  });

  it("campo simples sem resultado salvo ganha uma run com o marcador", () => {
    expect(markPageFields(ftr('<w:fldSimple w:instr="NUMPAGES"/>'))).toContain(NUMPAGES_MARK);
  });

  it("outro campo simples (DATE) é desembrulhado mantendo o valor salvo", () => {
    const out = markPageFields(
      ftr('<w:fldSimple w:instr="DATE"><w:r><w:t>23/09/2026</w:t></w:r></w:fldSimple>'),
    );
    expect(out).not.toContain("fldSimple");
    expect(out).toContain("<w:t>23/09/2026</w:t>");
  });

  it("campo complexo em várias runs: 1º texto do resultado vira marcador, o resto some", () => {
    const xml = ftr(
      '<w:r><w:t xml:space="preserve">Página </w:t></w:r>' +
        '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
        '<w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>' +
        '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
        "<w:r><w:t>1</w:t></w:r><w:r><w:t>0</w:t></w:r>" +
        '<w:r><w:fldChar w:fldCharType="end"/></w:r>' +
        '<w:r><w:t xml:space="preserve"> de </w:t></w:r>' +
        '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>NUMPAGES</w:instrText></w:r>' +
        '<w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>3</w:t></w:r>' +
        '<w:r><w:fldChar w:fldCharType="end"/></w:r>',
    );
    const out = markPageFields(xml);
    expect(out).toContain(`<w:t>${PAGE_MARK}</w:t>`);
    expect(out).toContain(`<w:t>${NUMPAGES_MARK}</w:t>`);
    expect(out).not.toContain("<w:t>1</w:t>");
    expect(out).not.toContain("<w:t>0</w:t>");
    expect(out).toContain("Página ");
  });

  it("sem campo de página: devolve a MESMA string (sem reserializar)", () => {
    const xml = ftr("<w:r><w:t>Av. Siqueira Campos</w:t></w:r>");
    expect(markPageFields(xml)).toBe(xml);
  });

  it("XML inválido: devolve a entrada", () => {
    expect(markPageFields("<w:ftr><w:p>")).toBe("<w:ftr><w:p>");
  });
});

describe("fillPageMarks", () => {
  it("troca os marcadores pelo número da página e o total", () => {
    const doc = new DOMParser().parseFromString(
      `<div><span>Página ${PAGE_MARK} de ${NUMPAGES_MARK}</span><b>${PAGE_MARK}</b></div>`,
      "text/xml",
    );
    fillPageMarks(doc.documentElement as unknown as Node, 2, 5);
    expect(new XMLSerializer().serializeToString(doc)).toBe(
      "<div><span>Página 2 de 5</span><b>2</b></div>",
    );
  });
});
