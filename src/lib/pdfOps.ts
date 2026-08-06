import { PDFDocument } from "pdf-lib";
import { passwordProtectedError } from "./pdfErrors";

/**
 * Load pra manipulação: `ignoreEncryption` deixa o parse passar, mas PDF
 * REALMENTE cifrado (user ou owner password) quebra depois no copyPages/save
 * com erro críptico — validado empiricamente com fixture AES-256: "Expected
 * instance of PDFDict, but got instance of undefined". Falha cedo com o erro
 * de senha padronizado (as telas mapeiam pra mensagem amigável).
 */
async function loadForOps(bytes: Uint8Array): Promise<PDFDocument> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  if (doc.isEncrypted) throw passwordProtectedError();
  return doc;
}

/** Junta N PDFs em um, na ordem recebida (sem re-render). */
export async function mergePdfs(pdfs: Uint8Array[]): Promise<Uint8Array> {
  if (pdfs.length === 0) throw new Error("nenhum PDF para juntar");
  const out = await PDFDocument.create();
  for (const bytes of pdfs) {
    const src = await loadForOps(bytes);
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
  const src = await loadForOps(pdf);
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
