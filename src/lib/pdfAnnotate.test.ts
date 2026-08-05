import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import {
  annotatePdf,
  hexToRgb01,
  strokeToSvgPath,
  winAnsiSafe,
  type AnnotationMap,
} from "./pdfAnnotate";

async function makePdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([595, 842]);
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
});
