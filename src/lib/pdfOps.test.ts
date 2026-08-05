import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { mergePdfs, extractPages } from "./pdfOps";

async function makePdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([200, 200]);
  return doc.save();
}
const count = async (bytes: Uint8Array) =>
  (await PDFDocument.load(bytes)).getPageCount();

describe("pdfOps", () => {
  it("mergePdfs: 3 + 5 = 8 páginas na ordem dada", async () => {
    const merged = await mergePdfs([await makePdf(3), await makePdf(5)]);
    expect(await count(merged)).toBe(8);
  });
  it("extractPages: mantém só as pedidas", async () => {
    const out = await extractPages(await makePdf(10), [5]);
    expect(await count(out)).toBe(1);
  });
  it("extractPages: várias páginas em ordem", async () => {
    const out = await extractPages(await makePdf(10), [1, 2, 9]);
    expect(await count(out)).toBe(3);
  });
});
