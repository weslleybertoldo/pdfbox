import { describe, it, expect } from "vitest";
import {
  clampGesture,
  clampPreview,
  physicalRatio,
  scaleAbout,
  scrollToFraction,
  toPageFraction,
  MAX_CANVAS_DIM,
  VIEWER_MAX_CANVAS_PIXELS,
} from "./zoomMath";

describe("physicalRatio", () => {
  it("página pequena: usa o DPR inteiro", () => {
    expect(physicalRatio(344, 487, 3)).toBe(3);
    expect(physicalRatio(344, 487, 3, { pixels: VIEWER_MAX_CANVAS_PIXELS })).toBe(3);
  });
  it("maior dimensão limitada por MAX_CANVAS_DIM (sem teto de pixels)", () => {
    // zoom 3 num DPR 3: 1188×1680 CSS → 1680×3 = 5040 > 4096 → 4096/1680
    expect(physicalRatio(1188, 1680, 3)).toBeCloseTo(MAX_CANVAS_DIM / 1680, 6);
  });
  it("teto de pixels do viewer segura o total em ~6 MP", () => {
    const r = physicalRatio(1188, 1680, 3, { pixels: VIEWER_MAX_CANVAS_PIXELS });
    expect(r).toBeCloseTo(Math.sqrt(VIEWER_MAX_CANVAS_PIXELS / (1188 * 1680)), 6);
    expect(1188 * r * (1680 * r)).toBeLessThanOrEqual(VIEWER_MAX_CANVAS_PIXELS + 1);
    expect(r).toBeGreaterThan(1.5); // continua acima de 1 px físico por px CSS
  });
  it("conversões (sem maxPixels) não perdem resolução em escala alta", () => {
    // PDF→imagem em escala 4 (2448×3168 = 7,75 MP): só o limite de dimensão vale
    expect(physicalRatio(2448, 3168, 1)).toBe(1);
  });
});

describe("toPageFraction / scrollToFraction", () => {
  it("sem zoom nem rolagem, o ponto já está no lugar", () => {
    const pagina = { left: 8, top: 176, width: 396, height: 560 };
    const f = toPageFraction(206, 246, pagina);
    expect(f).toEqual({ rx: 0.5, ry: 0.125 });
    expect(scrollToFraction({ ...f, x: 206, y: 246 }, pagina)).toEqual({ dx: 0, dy: 0 });
  });
  it("página de 1 folha centralizada (my-auto) que cresce: o vão acima dela não escala", () => {
    // logo a 60 px do topo da página, que estava centralizada (topo em 176);
    // ×3 a página passa da tela e o my-auto zera: topo em 84 (header 76 + p-2)
    const antes = { left: 8, top: 176, width: 400, height: 500 };
    const f = toPageFraction(208, 236, antes);
    const depois = { left: 8, top: 84, width: 1200, height: 1500 };
    // logo agora em 84 + 180 = 264 → rolar 28 pra ela voltar a y=236 (a conta
    // proporcional ao container mandava rolar ~300 e a logo sumia pra cima)
    expect(scrollToFraction({ ...f, x: 208, y: 236 }, depois)).toEqual({ dx: 400, dy: 28 });
  });
  it("leva o ponto até onde os dedos terminaram (arrasto no preview)", () => {
    const f = toPageFraction(100, 300, { left: 0, top: 200, width: 400, height: 400 });
    const depois = { left: -100, top: 0, width: 800, height: 800 }; // ×2
    // ponto em (100, 200) na página nova; dedos terminaram em (150, 250)
    expect(scrollToFraction({ ...f, x: 150, y: 250 }, depois)).toEqual({ dx: -50, dy: -50 });
  });
});

describe("clampPreview / scaleAbout", () => {
  it("página menor que a área → centralizada, ignora a posição pedida", () => {
    // área de 8 a 404 (396 px), página de 300 → começa em 8 + 48 = 56
    expect(clampPreview(-40, 300, 8, 396)).toBe(56);
    expect(clampPreview(500, 300, 8, 396)).toBe(56);
  });
  it("center=false: coluna que cabe fica alinhada ao início (contínuo multi-página)", () => {
    expect(clampPreview(300, 500, 56, 800, false)).toBe(56);
  });
  it("página maior que a área → sem vão em nenhuma borda", () => {
    // página de 800 numa área de 396 a partir de 8: left entre 8+396-800=-396 e 8
    expect(clampPreview(-100, 800, 8, 396)).toBe(-100); // no meio: livre
    expect(clampPreview(50, 800, 8, 396)).toBe(8); // abriria vão à esquerda
    expect(clampPreview(-700, 800, 8, 396)).toBe(-396); // abriria vão à direita
  });
  it("scaleAbout: a origem fica parada, o resto escala", () => {
    expect(scaleAbout(206, 206, 0.5)).toBe(206);
    expect(scaleAbout(0, 206, 0.5)).toBe(103);
    expect(scaleAbout(412, 206, 2)).toBe(618);
  });
});

describe("clampGesture", () => {
  it("mantém a escala final dentro de [0.5, 3]", () => {
    expect(clampGesture(2, 2, 0.5, 3)).toBe(1.5); // 2×2=4 → teto 3 → g=1.5
    expect(clampGesture(0.1, 2, 0.5, 3)).toBe(0.25); // 2×0.1=0.2 → piso 0.5 → g=0.25
    expect(clampGesture(1.2, 2, 0.5, 3)).toBe(1.2);
    expect(clampGesture(5, 1, 0.5, 3)).toBe(3);
  });
});
