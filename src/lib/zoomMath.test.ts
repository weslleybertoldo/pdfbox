import { describe, it, expect } from "vitest";
import {
  clampGesture,
  clampPreview,
  focalScroll,
  physicalRatio,
  scaleAbout,
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

describe("focalScroll", () => {
  it("equivale à fórmula antiga do contínuo quando os dedos não se movem", () => {
    // scroll do documento 500, foco em y=300 na tela, topo do container em 200
    // (coord. do documento) → rect.top = -300 → foco no conteúdo = 600
    const startScrollTop = 500;
    const focoY = 300;
    const topoContainer = 200;
    const ratio = 2;
    const antiga = (startScrollTop + focoY - topoContainer) * ratio + topoContainer - focoY;
    const nova = focalScroll({
      content: focoY - (topoContainer - startScrollTop),
      view: focoY,
      ratio,
      base: topoContainer,
    });
    expect(nova).toBe(antiga);
    expect(nova).toBe(1100);
  });
  it("desloca o alvo pelo arrasto dos dedos (conteúdo seguiu junto no preview)", () => {
    const base = { content: 600, view: 300, ratio: 2, base: 200 };
    expect(focalScroll({ ...base, shift: 50 })).toBe(1050); // dedos desceram 50 → rola menos
    expect(focalScroll({ ...base, shift: -50 })).toBe(1150);
  });
  it("scroll interno (livro/horizontal): base 0 e clamp em 0", () => {
    expect(focalScroll({ content: 120 + 80, view: 80, ratio: 1.5 })).toBe(220);
    expect(focalScroll({ content: 10, view: 100, ratio: 0.5 })).toBe(0);
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
