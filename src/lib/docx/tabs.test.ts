import { beforeAll, describe, expect, it } from "vitest";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { encodeTabSpec, expandTabMarks, markTabs, parseTabSpec, readStyleTabs, tabWidth, TAB_CLASS } from "./tabs";

// ambiente node: o módulo usa DOMParser/XMLSerializer globais (no app, os do browser)
beforeAll(() => {
  Object.assign(globalThis, { DOMParser, XMLSerializer });
});

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const ftr = (body: string) => `<?xml version="1.0"?><w:ftr ${W}>${body}</w:ftr>`;
const NO_STYLES = readStyleTabs("");
const spec = (out: string) => /([^]*)/.exec(out)?.[1];

// rodapé do ofício 014/2026 da FABd: CNPJ numa parada central (paradas no próprio parágrafo)
const CNPJ =
  '<w:p><w:pPr><w:tabs><w:tab w:val="center" w:leader="none" w:pos="4252"/><w:tab w:val="right" w:leader="none" w:pos="8504"/></w:tabs></w:pPr>' +
  "<w:r><w:tab/><w:t>21.256.269/0001-03</w:t></w:r></w:p>";

const STYLES = `<?xml version="1.0"?><w:styles ${W}>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:pPr><w:tabs><w:tab w:val="left" w:pos="1000"/></w:tabs></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="Rodape"><w:basedOn w:val="Normal"/><w:pPr><w:tabs><w:tab w:val="clear" w:pos="1000"/><w:tab w:val="center" w:pos="4252"/><w:tab w:val="right" w:pos="8504"/></w:tabs></w:pPr></w:style>
</w:styles>`;

describe("markTabs", () => {
  it("troca o w:tab da run pelo marcador com as paradas do parágrafo e mantém as definições", () => {
    const out = markTabs(ftr(CNPJ), NO_STYLES, 720);
    expect(spec(out)).toBe("720|c4252,r8504");
    expect(out).toContain('w:pos="4252"');
    expect(out).toContain("21.256.269/0001-03");
    expect(out).not.toContain("<w:tab/>");
  });

  it("herda as paradas do estilo (basedOn) e aplica o clear do parágrafo", () => {
    const styles = readStyleTabs(STYLES);
    const p = (pPr: string) => ftr(`<w:p><w:pPr>${pPr}</w:pPr><w:r><w:t>a</w:t><w:tab/><w:t>b</w:t></w:r></w:p>`);
    expect(spec(markTabs(p('<w:pStyle w:val="Rodape"/>'), styles, 708))).toBe("708|c4252,r8504");
    expect(spec(markTabs(p('<w:pStyle w:val="Rodape"/><w:tabs><w:tab w:val="clear" w:pos="8504"/></w:tabs>'), styles, 708)))
      .toBe("708|c4252");
    // sem pStyle vale o estilo padrão
    expect(spec(markTabs(p(""), styles, 708))).toBe("708|l1000");
  });

  it("guarda o preenchimento da parada (pontilhado / linha)", () => {
    const out = markTabs(
      ftr('<w:p><w:pPr><w:tabs><w:tab w:val="right" w:leader="dot" w:pos="9000"/></w:tabs></w:pPr><w:r><w:t>Cap. 1</w:t><w:tab/><w:t>3</w:t></w:r></w:p>'),
      NO_STYLES,
      720,
    );
    expect(spec(out)).toBe("720|r9000.");
  });

  it("sem tabulação em run devolve o mesmo texto", () => {
    const xml = ftr('<w:p><w:pPr><w:tabs><w:tab w:val="center" w:pos="4252"/></w:tabs></w:pPr><w:r><w:t>x</w:t></w:r></w:p>');
    expect(markTabs(xml, NO_STYLES, 720)).toBe(xml);
    expect(markTabs("<nada", NO_STYLES, 720)).toBe("<nada");
  });
});

describe("parseTabSpec", () => {
  it("lê o que o encode escreveu e aguenta lixo", () => {
    const s = { defTwips: 708, stops: [{ kind: "c" as const, pos: 4252, leader: "" as const }, { kind: "r" as const, pos: 8504, leader: "." as const }] };
    expect(parseTabSpec(encodeTabSpec(s))).toEqual(s);
    expect(parseTabSpec("lixo")).toEqual({ defTwips: 720, stops: [] });
  });
});

describe("tabWidth", () => {
  const S = (raw: string) => parseTabSpec(raw);

  it("parada central: o trecho seguinte fica centrado nela (CNPJ do ofício)", () => {
    // 4252 twips = 212,6 pt; texto de 100 pt começando na margem
    expect(tabWidth(S("720|c4252,r8504"), 0, 100, 425.2).width).toBeCloseTo(162.6, 5);
  });

  it("parada à direita: o trecho termina nela, sem passar do fim da linha", () => {
    expect(tabWidth(S("720|r8504"), 10, 50, 1000).width).toBeCloseTo(365.2, 5);
    // na margem direita: meio ponto de folga pra não quebrar a linha
    expect(tabWidth(S("720|r8504"), 10, 50, 415.2).width).toBeCloseTo(364.7, 5);
  });

  it("sem parada própria: próxima padrão; parada exata vai pra seguinte", () => {
    expect(tabWidth(S("720|"), 30, 0, 400).width).toBeCloseTo(6, 5);
    expect(tabWidth(S("720|"), 36, 0, 400).width).toBeCloseTo(36, 5);
  });

  it("depois da última parada própria volta pras padrão", () => {
    expect(tabWidth(S("720|l100"), 10, 0, 400).width).toBeCloseTo(26, 5);
    expect(tabWidth(S("720|c4252"), 250, 0, 400).width).toBeCloseTo(2, 5);
  });

  it("recuo deslocado vira parada implícita; decimal vai como direita; preenchimento passa adiante", () => {
    expect(tabWidth(S("720|"), 5, 0, 400, 18).width).toBeCloseTo(13, 5);
    expect(tabWidth(S("720|d2000"), 0, 30, 400).width).toBeCloseTo(70, 5);
    expect(tabWidth(S("720|r9000."), 50, 10, 1000).leader).toBe(".");
  });

  it("trecho largo demais não dá largura negativa", () => {
    expect(tabWidth(S("720|c4252"), 200, 400, 425).width).toBe(0);
  });
});

describe("expandTabMarks", () => {
  it("troca o marcador por um span com as paradas e deixa o texto em volta", () => {
    const doc = new DOMParser().parseFromString("<div><span>a720|c4252b</span></div>", "text/xml");
    const root = doc.documentElement!;
    expandTabMarks(root as unknown as Node);
    const run = root.firstChild as unknown as Element;
    expect(run.childNodes.length).toBe(3);
    expect(run.firstChild!.textContent).toBe("a");
    const tab = run.childNodes[1] as unknown as Element;
    expect(tab.getAttribute("class")).toBe(TAB_CLASS);
    expect(tab.getAttribute("data-tab")).toBe("720|c4252");
    expect(tab.textContent).toBe(" ");
    expect(run.lastChild!.textContent).toBe("b");
    expect(new XMLSerializer().serializeToString(doc)).not.toContain("");
  });
});
