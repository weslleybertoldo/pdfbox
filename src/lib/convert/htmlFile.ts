import { htmlToPageCanvases, canvasesToPdf, canvasesToImages } from "./htmlPipeline";

export const htmlFileToPdf = async (f: File) => canvasesToPdf(await htmlToPageCanvases(await f.text()));
export const htmlFileToImages = async (f: File, base: string, fmt: "png" | "jpg") =>
  canvasesToImages(await htmlToPageCanvases(await f.text()), base, fmt);
