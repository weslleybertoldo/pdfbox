import { describe, it, expect } from "vitest";
import { buildText, findMatches, normalizeForSearch, splitMatch } from "./textSearch";

describe("normalizeForSearch", () => {
  it("minúsculas, sem acento, mapa aponta pro índice original", () => {
    const n = normalizeForSearch("Água Pé");
    expect(n.norm).toBe("agua pe");
    // "Á"(0) g(1) u(2) a(3) " "(4) P(5) é(6)
    expect(n.map).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("colapsa runs de espaço/quebra num único espaço e ignora os das pontas", () => {
    const n = normalizeForSearch("  Total   a\n\tPagar  ");
    expect(n.norm).toBe("total a pagar");
    // o " " colapsado aponta pro 1º espaço do run
    expect(n.map[5]).toBe(7); // "Total" ocupa 2..6 → run de espaços começa em 7
  });

  it("ligadura vira 2 letras mapeadas pro MESMO índice original", () => {
    const n = normalizeForSearch("oﬁcina"); // ﬁ = U+FB01
    expect(n.norm).toBe("oficina");
    expect(n.map).toEqual([0, 1, 1, 2, 3, 4, 5]);
  });

  it("texto vazio / só espaços", () => {
    expect(normalizeForSearch("").norm).toBe("");
    expect(normalizeForSearch("   \n ").norm).toBe("");
  });
});

describe("findMatches", () => {
  it("sem acento e sem caixa, offsets ORIGINAIS", () => {
    const text = "Consumo (kWh) e Benefício Tarifário. CONSUMO alto.";
    const n = normalizeForSearch(text);
    const ms = findMatches(n, "consumo");
    expect(ms).toHaveLength(2);
    expect(text.slice(ms[0].start, ms[0].end)).toBe("Consumo");
    expect(text.slice(ms[1].start, ms[1].end)).toBe("CONSUMO");
    const b = findMatches(n, "beneficio tarifario");
    expect(b).toHaveLength(1);
    expect(text.slice(b[0].start, b[0].end)).toBe("Benefício Tarifário");
  });

  it("consulta com espaços irregulares casa com o texto colapsado", () => {
    const text = "Total   a\nPagar";
    const ms = findMatches(normalizeForSearch(text), "  total a pagar ");
    expect(ms).toHaveLength(1);
    expect(text.slice(ms[0].start, ms[0].end)).toBe("Total   a\nPagar");
  });

  it("ocorrências não se sobrepõem; consulta vazia = nada", () => {
    const n = normalizeForSearch("aaaa");
    expect(findMatches(n, "aa")).toHaveLength(2);
    expect(findMatches(n, "")).toEqual([]);
    expect(findMatches(n, "   ")).toEqual([]);
  });

  it("fim da ocorrência que termina em ligadura cobre o caractere inteiro", () => {
    const text = "oﬁ";
    const ms = findMatches(normalizeForSearch(text), "of");
    expect(ms).toEqual([{ start: 0, end: 2 }]);
  });
});

describe("buildText + splitMatch", () => {
  // items do pdf.js: palavra quebrada em 2 spans + fim de linha (separador)
  const parts = [
    { text: "Fa" },
    { text: "tura", sepAfter: true }, // hasEOL → " " fora de qualquer peça
    { text: "de Energia" },
    { text: "" }, // item vazio (sem span no DOM)
    { text: " Elétrica" },
  ];
  const { text, pieces } = buildText(parts);

  it("concatena com separador fora das peças", () => {
    expect(text).toBe("Fatura de Energia Elétrica");
    expect(pieces).toEqual([
      { start: 0, length: 2 },
      { start: 2, length: 4 },
      { start: 7, length: 10 },
      { start: 17, length: 0 },
      { start: 17, length: 9 },
    ]);
  });

  it("ocorrência atravessando 2 spans vira 2 segmentos", () => {
    const [m] = findMatches(normalizeForSearch(text), "fatura");
    expect(splitMatch(m, pieces)).toEqual([
      { piece: 0, start: 0, end: 2 },
      { piece: 1, start: 0, end: 4 },
    ]);
  });

  it("separador de fim de linha não gera segmento", () => {
    const [m] = findMatches(normalizeForSearch(text), "tura de");
    expect(splitMatch(m, pieces)).toEqual([
      { piece: 1, start: 0, end: 4 },
      { piece: 2, start: 0, end: 2 },
    ]);
  });

  it("peça vazia é pulada; acento não atrapalha o offset", () => {
    const [m] = findMatches(normalizeForSearch(text), "energia eletrica");
    expect(splitMatch(m, pieces)).toEqual([
      { piece: 2, start: 3, end: 10 },
      { piece: 4, start: 0, end: 9 },
    ]);
  });
});
