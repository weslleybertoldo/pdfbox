import { PDFDocument } from "pdf-lib";

/** Imagens (PNG/JPG/WebP) → 1 PDF, 1 imagem por página no tamanho da imagem. */
export async function imagesToPdf(files: { bytes: Uint8Array; type: string }[]): Promise<Uint8Array> {
  if (files.length === 0) throw new Error("nenhuma imagem para converter");
  const doc = await PDFDocument.create();
  for (const f of files) {
    let bytes = f.bytes;
    const isPng = f.type.includes("png");
    if (!isPng && !f.type.includes("jpeg") && !f.type.includes("jpg")) {
      // WebP e outros: re-encoda pra JPEG via canvas
      bytes = await reencodeToJpeg(f.bytes, f.type);
    }
    const img = isPng ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
    const page = doc.addPage([img.width, img.height]);
    page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
  }
  return doc.save();
}

async function reencodeToJpeg(bytes: Uint8Array, type: string): Promise<Uint8Array> {
  const bmp = await createImageBitmap(new Blob([bytes], { type }));
  const canvas = document.createElement("canvas");
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  canvas.getContext("2d")!.drawImage(bmp, 0, 0);
  const blob: Blob = await new Promise((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error("toBlob"))), "image/jpeg", 0.92),
  );
  return new Uint8Array(await blob.arrayBuffer());
}
