import { Document, Packer, Paragraph, TextRun, ImageRun } from "docx";
import * as pdfjs from "pdfjs-dist";
import { loadPdf } from "../pdfRender";

/**
 * Extrai texto por página (linhas agrupadas pela coordenada Y) + imagens
 * XObject da página, e monta um .docx. Layout complexo degrada (aceito na spec).
 */
export async function pdfToDocx(
  bytes: Uint8Array,
  onProgress?: (done: number, total: number) => void,
): Promise<Blob> {
  const doc = await loadPdf(bytes);
  const children: Paragraph[] = [];

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);

    // ── texto: agrupa itens pela linha (Y arredondado) ──
    const content = await page.getTextContent();
    const lines = new Map<number, { x: number; str: string }[]>();
    for (const item of content.items as { str: string; transform: number[] }[]) {
      if (!item.str.trim()) continue;
      const y = Math.round(item.transform[5]);
      if (!lines.has(y)) lines.set(y, []);
      lines.get(y)!.push({ x: item.transform[4], str: item.str });
    }
    const sorted = [...lines.entries()].sort((a, b) => b[0] - a[0]); // topo→base
    for (const [, parts] of sorted) {
      const text = parts.sort((a, b) => a.x - b.x).map((s) => s.str).join(" ");
      children.push(new Paragraph({ children: [new TextRun(text)] }));
    }

    // ── imagens: XObjects pintados na página ──
    const ops = await page.getOperatorList();
    const seen = new Set<string>();
    for (let i = 0; i < ops.fnArray.length; i++) {
      if (ops.fnArray[i] !== pdfjs.OPS.paintImageXObject) continue;
      const objId = ops.argsArray[i][0] as string;
      if (seen.has(objId)) continue;
      seen.add(objId);
      try {
        const img = await new Promise<{ bitmap?: ImageBitmap; width: number; height: number }>(
          (resolve, reject) => {
            try { page.objs.get(objId, resolve); } catch (e) { reject(e); }
          },
        );
        if (!img?.bitmap) continue;
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        canvas.getContext("2d")!.drawImage(img.bitmap, 0, 0);
        const pngBlob: Blob = await new Promise((res, rej) =>
          canvas.toBlob((b) => (b ? res(b) : rej(new Error("toBlob"))), "image/png"),
        );
        const maxW = 600; // pontos dentro do A4
        const scale = Math.min(1, maxW / img.width);
        children.push(
          new Paragraph({
            children: [
              new ImageRun({
                data: await pngBlob.arrayBuffer(),
                transformation: { width: img.width * scale, height: img.height * scale },
                type: "png",
              }),
            ],
          }),
        );
      } catch { /* imagem não decodificável → segue sem ela */ }
    }
    if (p < doc.numPages) children.push(new Paragraph({ pageBreakBefore: true }));
    onProgress?.(p, doc.numPages);
  }

  const out = new Document({ sections: [{ children }] });
  return Packer.toBlob(out);
}
