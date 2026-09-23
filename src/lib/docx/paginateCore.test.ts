import { describe, expect, it } from "vitest";
import { cssLengthToPx, findCut, type BlockInfo } from "./paginateCore";

/** Parágrafo de `lines` linhas iguais entre top e bottom. */
const p = (top: number, bottom: number, lines?: number): BlockInfo => {
  const h = lines ? (bottom - top) / lines : 0;
  return {
    kind: "p",
    top,
    bottom,
    lines: lines
      ? Array.from({ length: lines }, (_, i) => ({ top: top + i * h, bottom: top + (i + 1) * h }))
      : undefined,
  };
};

describe("findCut", () => {
  it("tudo cabe → null", () => {
    expect(findCut([p(0, 100, 5), p(100, 200, 5)], 200)).toBeNull();
  });

  it("parágrafo que passa do limite fica com o que cabe (≥2 linhas de cada lado)", () => {
    // 10 linhas de 20px a partir de 100; limite 250 → cabem 7 (até 240)
    expect(findCut([p(0, 100, 5), p(100, 300, 10)], 250)).toEqual({ index: 1, mode: "lines", keep: 7 });
  });

  it("viúva: se só 1 linha desceria, descem 2", () => {
    // 5 linhas de 20px a partir de 100; limite 185 → cabem 4 → ficam 3
    expect(findCut([p(0, 100, 5), p(100, 200, 5)], 185)).toEqual({ index: 1, mode: "lines", keep: 3 });
  });

  it("órfã: se só 1 linha ficaria, o parágrafo desce inteiro", () => {
    expect(findCut([p(0, 100, 5), p(100, 200, 5)], 125)).toEqual({ index: 1, mode: "before" });
  });

  it("parágrafo curto (3 linhas) que não cabe desce inteiro", () => {
    expect(findCut([p(0, 100, 5), p(100, 160, 3)], 150)).toEqual({ index: 1, mode: "before" });
  });

  it("no topo da página corta onde der, mesmo quebrando a regra das 2 linhas", () => {
    expect(findCut([p(0, 300, 3)], 250)).toEqual({ index: 0, mode: "lines", keep: 2 });
  });

  it("bloco no topo sem ponto de corte → null (transborda)", () => {
    expect(findCut([{ kind: "other", top: 0, bottom: 900 }], 800)).toBeNull();
  });

  it("tabela: fica o que cabe, por linha", () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ top: 100 + i * 30, bottom: 130 + i * 30 }));
    expect(findCut([p(0, 100, 5), { kind: "table", top: 100, bottom: 400, rows }], 250)).toEqual({
      index: 1,
      mode: "rows",
      keep: 5,
    });
  });

  it("tabela sem nenhuma linha que caiba desce inteira", () => {
    const rows = [
      { top: 240, bottom: 300 },
      { top: 300, bottom: 360 },
    ];
    expect(findCut([p(0, 240, 5), { kind: "table", top: 240, bottom: 360, rows }], 250)).toEqual({
      index: 1,
      mode: "before",
    });
  });
});

describe("cssLengthToPx", () => {
  it("converte as unidades que a docx-preview escreve", () => {
    expect(cssLengthToPx("72pt")).toBeCloseTo(96);
    expect(cssLengthToPx("841.9pt")).toBeCloseTo(1122.53, 1);
    expect(cssLengthToPx("2.54cm")).toBeCloseTo(96);
    expect(cssLengthToPx("25.4mm")).toBeCloseTo(96);
    expect(cssLengthToPx("1in")).toBeCloseTo(96);
    expect(cssLengthToPx("100px")).toBe(100);
    expect(cssLengthToPx("")).toBe(0);
    expect(cssLengthToPx("auto")).toBe(0);
  });
});
