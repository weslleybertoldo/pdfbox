import { describe, it, expect } from "vitest";
import { isSafeUrl, linkTargets, resolvePageNumber, type ViewportLike } from "./pdfLinks";

/** Viewport fake de página 200×400 pt em escala 1, rotação 0 — mesma matriz
 *  que o pdf.js monta: [scale 0 0 -scale 0 altura] (eixo y invertido). */
const viewport: ViewportLike = { width: 200, height: 400, transform: [1, 0, 0, -1, 0, 400] };

describe("isSafeUrl", () => {
  it("aceita http(s), mailto e tel", () => {
    expect(isSafeUrl("https://www.amazon.com.br/dp/B0B5")).toBe(true);
    expect(isSafeUrl("http://exemplo.com")).toBe(true);
    expect(isSafeUrl("HTTPS://MAIUSCULO.COM")).toBe(true);
    expect(isSafeUrl("mailto:fabd@exemplo.com")).toBe(true);
    expect(isSafeUrl("tel:+5582999999999")).toBe(true);
  });
  it("recusa esquemas perigosos, relativas e não-strings", () => {
    expect(isSafeUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeUrl("file:///etc/passwd")).toBe(false);
    expect(isSafeUrl("data:text/html,<script>")).toBe(false);
    expect(isSafeUrl("intent://scan/#Intent;end")).toBe(false);
    expect(isSafeUrl("/relativa")).toBe(false);
    expect(isSafeUrl("")).toBe(false);
    expect(isSafeUrl(undefined)).toBe(false);
    expect(isSafeUrl(42)).toBe(false);
  });
});

describe("linkTargets", () => {
  it("converte rect PDF → % do box e separa URL de destino interno", () => {
    const targets = linkTargets(
      [
        { subtype: "Link", rect: [10, 380, 60, 390], url: "https://a.b/c" },
        { subtype: "Link", rect: [0, 0, 200, 40], dest: "sec3" },
        { subtype: "Link", rect: [20, 100, 120, 120], dest: [{ num: 7, gen: 0 }, { name: "Fit" }] },
      ],
      viewport,
    );
    expect(targets).toHaveLength(3);
    expect(targets[0]).toEqual({
      kind: "url",
      url: "https://a.b/c",
      rect: { left: 5, top: 2.5, width: 25, height: 2.5 },
    });
    expect(targets[1]).toMatchObject({ kind: "dest", dest: "sec3" });
    expect(targets[1].rect).toEqual({ left: 0, top: 90, width: 100, height: 10 });
    expect(targets[2]).toMatchObject({ kind: "dest", dest: [{ num: 7, gen: 0 }, { name: "Fit" }] });
  });
  it("usa unsafeUrl como reserva só se for segura; ignora ações e rects degenerados", () => {
    const targets = linkTargets(
      [
        { subtype: "Link", rect: [0, 0, 50, 50], unsafeUrl: "https://reserva.com" },
        { subtype: "Link", rect: [0, 0, 50, 50], unsafeUrl: "javascript:x()" },
        { subtype: "Link", rect: [0, 0, 50, 50], action: "GoToR" },
        { subtype: "Link", rect: [0, 0, 0.5, 50], url: "https://fino.com" }, // largura < 1
        { subtype: "Widget", rect: [0, 0, 50, 50], url: "https://form.com" },
        { subtype: "Link", rect: [0, 0, 50], url: "https://rect-quebrado.com" },
        null,
      ],
      viewport,
    );
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({ kind: "url", url: "https://reserva.com" });
  });
  it("normaliza rect com cantos invertidos", () => {
    const [t] = linkTargets([{ subtype: "Link", rect: [60, 390, 10, 380], url: "https://x.y" }], viewport);
    expect(t.rect).toEqual({ left: 5, top: 2.5, width: 25, height: 2.5 });
  });
});

describe("resolvePageNumber", () => {
  const doc = {
    getDestination: async (id: string) =>
      id === "sec3" ? [{ num: 12, gen: 0 }, { name: "XYZ" }, 0, 700, null] : null,
    getPageIndex: async (ref: object) => ((ref as { num: number }).num === 12 ? 2 : 0),
  };
  it("destino nomeado → 1-based via getDestination + getPageIndex", async () => {
    expect(await resolvePageNumber(doc, "sec3")).toBe(3);
  });
  it("array explícito com Ref → página; com índice numérico → índice + 1", async () => {
    expect(await resolvePageNumber(doc, [{ num: 12, gen: 0 }, { name: "Fit" }])).toBe(3);
    expect(await resolvePageNumber(doc, [4, { name: "Fit" }])).toBe(5);
  });
  it("destino desconhecido, vazio ou com erro → null", async () => {
    expect(await resolvePageNumber(doc, "nao-existe")).toBe(null);
    expect(await resolvePageNumber(doc, [])).toBe(null);
    expect(await resolvePageNumber(doc, [{ foo: 1 }])).toBe(null);
    const quebrado = {
      getDestination: async () => {
        throw new Error("boom");
      },
      getPageIndex: doc.getPageIndex,
    };
    expect(await resolvePageNumber(quebrado, "sec3")).toBe(null);
  });
});
