import { describe, it, expect } from "vitest";
import { applyFilter, FILTERS } from "./scanFilters";

const px = (r: number, g: number, b: number) =>
  new Uint8ClampedArray([r, g, b, 255]);

describe("scanFilters", () => {
  it("original não altera", () => {
    expect([...applyFilter(px(10, 200, 30), "original")]).toEqual([10, 200, 30, 255]);
  });
  it("grayscale: r=g=b (luminância)", () => {
    const out = applyFilter(px(255, 0, 0), "grayscale");
    expect(out[0]).toBe(out[1]);
    expect(out[1]).toBe(out[2]);
  });
  it("scanBW: claro vira ~branco, escuro vira ~preto", () => {
    expect(applyFilter(px(230, 230, 230), "scanBW")[0]).toBeGreaterThan(240);
    expect(applyFilter(px(40, 40, 40), "scanBW")[0]).toBeLessThan(20);
  });
  it("enhance aumenta contraste", () => {
    expect(applyFilter(px(200, 200, 200), "enhance")[0]).toBeGreaterThan(200);
    expect(applyFilter(px(60, 60, 60), "enhance")[0]).toBeLessThan(60);
  });
  it("expõe os 4 filtros da spec", () => {
    expect(FILTERS.map((f) => f.id)).toEqual(["original", "scanBW", "grayscale", "enhance"]);
  });
});
