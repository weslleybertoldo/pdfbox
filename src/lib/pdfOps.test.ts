import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { mergePdfs, extractPages } from "./pdfOps";

/** Cada página i (0-based) tem largura distinta (100 + i*10) para provar ordem. */
async function makePdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([100 + i * 10, 200]);
  return doc.save();
}
const count = async (bytes: Uint8Array) =>
  (await PDFDocument.load(bytes)).getPageCount();
const widths = async (bytes: Uint8Array) =>
  (await PDFDocument.load(bytes)).getPages().map((p) => p.getWidth());

describe("pdfOps", () => {
  it("mergePdfs: 3 + 5 = 8 páginas na ordem dada", async () => {
    const merged = await mergePdfs([await makePdf(3), await makePdf(5)]);
    expect(await count(merged)).toBe(8);
    expect(await widths(merged)).toEqual([
      100, 110, 120, // doc 1 (3 páginas)
      100, 110, 120, 130, 140, // doc 2 (5 páginas)
    ]);
  });
  it("extractPages: mantém só as pedidas", async () => {
    const out = await extractPages(await makePdf(10), [5]);
    expect(await count(out)).toBe(1);
    expect(await widths(out)).toEqual([140]); // página 5 (0-based idx 4) = 100+4*10
  });
  it("extractPages: várias páginas em ordem", async () => {
    const out = await extractPages(await makePdf(10), [1, 2, 9]);
    expect(await count(out)).toBe(3);
    expect(await widths(out)).toEqual([100, 110, 180]); // páginas 1,2,9
  });
  it("mergePdfs: lista vazia lança erro", async () => {
    await expect(mergePdfs([])).rejects.toThrow("nenhum PDF para juntar");
  });
  it("extractPages: seleção vazia lança erro", async () => {
    await expect(extractPages(await makePdf(3), [])).rejects.toThrow(
      "nenhuma página selecionada",
    );
  });
  it("extractPages: página inválida (fora do range) lança erro", async () => {
    await expect(extractPages(await makePdf(3), [4])).rejects.toThrow(
      "página inválida: 4",
    );
    await expect(extractPages(await makePdf(3), [0])).rejects.toThrow(
      "página inválida: 0",
    );
  });
});
