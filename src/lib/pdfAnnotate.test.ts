import { describe, it, expect } from "vitest";
import { PDFDocument, PDFRawStream, decodePDFRawStream, degrees } from "pdf-lib";
import {
  annotatePdf,
  displayedToPage,
  hexToRgb01,
  strokeToSvgPath,
  winAnsiSafe,
  type AnnotationMap,
} from "./pdfAnnotate";

async function makePdf(pages: number, rotate = 0): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) {
    const p = doc.addPage([595, 842]);
    if (rotate) p.setRotation(degrees(rotate));
  }
  return doc.save();
}

describe("pdfAnnotate helpers", () => {
  it("hexToRgb01 converte #rrggbb", () => {
    expect(hexToRgb01("#ff0000")).toEqual({ r: 1, g: 0, b: 0 });
    expect(hexToRgb01("#000000")).toEqual({ r: 0, g: 0, b: 0 });
    const { r, g, b } = hexToRgb01("#facc15");
    expect(r).toBeCloseTo(250 / 255);
    expect(g).toBeCloseTo(204 / 255);
    expect(b).toBeCloseTo(21 / 255);
  });
  it("hexToRgb01 rejeita cor inválida", () => {
    expect(() => hexToRgb01("red")).toThrow("cor inválida");
  });
  it("strokeToSvgPath monta M/L na ordem dos pontos", () => {
    expect(strokeToSvgPath([{ x: 1, y: 2 }, { x: 3.456, y: 4 }])).toBe("M 1,2 L 3.46,4");
  });
  it("strokeToSvgPath: 1 ponto vira tracinho (ponto visível)", () => {
    expect(strokeToSvgPath([{ x: 10, y: 20 }])).toBe("M 10,20 L 10.1,20");
  });
  it("winAnsiSafe preserva acentos e troca emoji por ?", () => {
    expect(winAnsiSafe("anotação")).toBe("anotação");
    expect(winAnsiSafe("ok \u{1F600}")).toBe("ok ?"); // spread itera por code point → 1 "?"
  });
});

describe("displayedToPage (compensação do /Rotate)", () => {
  // página real 595×842 (W×H); exibida: 0/180 → 595×842, 90/270 → 842×595
  const W = 595;
  const H = 842;

  it("0°: identidade + inversão do Y (origem topo → baixo)", () => {
    expect(displayedToPage(10, 20, 0, W, H)).toEqual({ x: 10, y: H - 20 });
  });
  it("90°: canto exibido topo-esquerda = canto da página baixo-esquerda", () => {
    // /Rotate 90 gira horário: o lado ESQUERDO exibido é o PÉ da página
    expect(displayedToPage(0, 0, 90, W, H)).toEqual({ x: 0, y: 0 });
    expect(displayedToPage(H, W, 90, W, H)).toEqual({ x: W, y: H }); // canto oposto
    expect(displayedToPage(200, 100, 90, W, H)).toEqual({ x: 100, y: 200 });
  });
  it("180°: espelha X, Y exibido pra baixo = Y da página pra cima", () => {
    expect(displayedToPage(0, 0, 180, W, H)).toEqual({ x: W, y: 0 });
    expect(displayedToPage(W, H, 180, W, H)).toEqual({ x: 0, y: H });
    expect(displayedToPage(10, 20, 180, W, H)).toEqual({ x: W - 10, y: 20 });
  });
  it("270°: inverso do 90", () => {
    expect(displayedToPage(0, 0, 270, W, H)).toEqual({ x: W, y: H });
    expect(displayedToPage(H, W, 270, W, H)).toEqual({ x: 0, y: 0 });
    expect(displayedToPage(200, 100, 270, W, H)).toEqual({ x: W - 100, y: H - 200 });
  });
  it("normaliza ângulos negativos e >360 (-90 ≡ 270, 450 ≡ 90)", () => {
    expect(displayedToPage(200, 100, -90, W, H)).toEqual(displayedToPage(200, 100, 270, W, H));
    expect(displayedToPage(200, 100, 450, W, H)).toEqual(displayedToPage(200, 100, 90, W, H));
  });
  it("round-trip: cada rotação é bijetiva nos 4 cantos exibidos", () => {
    for (const rot of [0, 90, 180, 270]) {
      const [wd, hd] = rot % 180 === 0 ? [W, H] : [H, W]; // dims exibidas
      for (const [x, y] of [[0, 0], [wd, 0], [0, hd], [wd, hd]] as const) {
        const p = displayedToPage(x, y, rot, W, H);
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(W);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThanOrEqual(H);
      }
    }
  });
});

describe("annotatePdf", () => {
  const annots: AnnotationMap = new Map([
    [1, [{ kind: "text", x: 50, y: 100, text: "QA-NOTA", size: 14, color: "#000000" }]],
    [2, [{ kind: "draw", points: [{ x: 10, y: 10 }, { x: 100, y: 50 }], width: 4, color: "#ef4444" }]],
    [3, [{ kind: "highlight", x: 20, y: 30, w: 200, h: 40, color: "#facc15" }]],
  ]);

  it("preserva as páginas e devolve um PDF válido maior", async () => {
    const src = await makePdf(3);
    const out = await annotatePdf(src, annots);
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(3);
    expect(doc.getPages().map((p) => p.getWidth())).toEqual([595, 595, 595]);
    expect(out.byteLength).toBeGreaterThan(src.byteLength);
  });
  it("página fora do documento lança erro", async () => {
    const bad: AnnotationMap = new Map([
      [9, [{ kind: "highlight", x: 0, y: 0, w: 10, h: 10, color: "#facc15" }]],
    ]);
    await expect(annotatePdf(await makePdf(3), bad)).rejects.toThrow("página inválida: 9");
  });
  it("mapa vazio devolve PDF equivalente (sem anotar nada)", async () => {
    const out = await annotatePdf(await makePdf(2), new Map());
    expect((await PDFDocument.load(out)).getPageCount()).toBe(2);
  });

  /** Content streams do PDF (FlateDecode) → texto com os operadores. */
  const contentOps = async (bytes: Uint8Array): Promise<string> => {
    const doc = await PDFDocument.load(bytes);
    return doc.context
      .enumerateIndirectObjects()
      .map(([, o]) => o)
      .filter((o): o is PDFRawStream => o instanceof PDFRawStream)
      .map((s) => Buffer.from(decodePDFRawStream(s).decode()).toString("latin1"))
      .join("\n");
  };

  it("página /Rotate 90: highlight exibido vira retângulo transformado na página", async () => {
    // exibido (x=10, y=20, w=30, h=40) em página 595×842 girada 90°:
    // cantos (10,20) e (40,60) → página (20,10) e (60,40) → rect em (20,10) 40×30
    const src = await makePdf(1, 90);
    const out = await annotatePdf(src, new Map([
      [1, [{ kind: "highlight", x: 10, y: 20, w: 30, h: 40, color: "#facc15" }]],
    ]));
    const ops = await contentOps(out);
    // drawRectangle = translate (cm) + path: origem (20,10), lados 40 (x) e 30 (y)
    expect(ops).toMatch(/1 0 0 1 20 10 cm/);
    expect(ops).toMatch(/0 30 l\n40 30 l\n40 0 l/);
    expect((await PDFDocument.load(out)).getPage(0).getRotation().angle).toBe(90);
  });

  it("página /Rotate 90: texto ancora transformado e gira 90° (Tm)", async () => {
    // exibido (100, 200) → página (200, 100); rotate 90° → Tm ≈ [0 1 -1 0 200 100]
    const out = await annotatePdf(await makePdf(1, 90), new Map([
      [1, [{ kind: "text", x: 100, y: 200, text: "GIRO", size: 14, color: "#000000" }]],
    ]));
    expect(await contentOps(out)).toMatch(/\S+ 1 -1 \S+ 200 100 Tm/); // cos(90°)≈6e-17
  });

  it("página /Rotate 0 segue com o mapeamento original (regressão)", async () => {
    const out = await annotatePdf(await makePdf(1), new Map([
      [1, [{ kind: "highlight", x: 10, y: 20, w: 30, h: 40, color: "#facc15" }]],
    ]));
    // y = H - y - h = 842 - 20 - 40 = 782; rect em (10,782) 30×40
    const ops = await contentOps(out);
    expect(ops).toMatch(/1 0 0 1 10 782 cm/);
    expect(ops).toMatch(/0 40 l\n30 40 l\n30 0 l/);
  });
});
