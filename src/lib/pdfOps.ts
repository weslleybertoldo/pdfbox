import { PDFDocument } from "pdf-lib";

/** Junta N PDFs em um, na ordem recebida (sem re-render). */
export async function mergePdfs(pdfs: Uint8Array[]): Promise<Uint8Array> {
  if (pdfs.length === 0) throw new Error("nenhum PDF para juntar");
  const out = await PDFDocument.create();
  for (const bytes of pdfs) {
    const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach((p) => out.addPage(p));
  }
  return out.save();
}

/** Novo PDF só com as páginas pedidas (1-based, na ordem dada). */
export async function extractPages(
  pdf: Uint8Array,
  pages1Based: number[],
): Promise<Uint8Array> {
  if (pages1Based.length === 0) throw new Error("nenhuma página selecionada");
  const src = await PDFDocument.load(pdf, { ignoreEncryption: true });
  const pageCount = src.getPageCount();
  for (const p of pages1Based) {
    if (p < 1 || p > pageCount) throw new Error(`página inválida: ${p}`);
  }
  const out = await PDFDocument.create();
  const idx = pages1Based.map((p) => p - 1);
  const copied = await out.copyPages(src, idx);
  copied.forEach((p) => out.addPage(p));
  return out.save();
}
