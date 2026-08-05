import mammoth from "mammoth/mammoth.browser";
import { htmlToPageImages, pageImagesToPdf, pageImagesToFiles } from "./htmlPipeline";

export async function docxToHtml(file: File): Promise<string> {
  const { value } = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
  return `<div style="font-family:serif;font-size:16px;line-height:1.5;padding:40px">${value}</div>`;
}
export const docxToPdf = async (f: File) => pageImagesToPdf(await htmlToPageImages(await docxToHtml(f)));
export const docxToImages = async (f: File, base: string, fmt: "png" | "jpg") =>
  pageImagesToFiles(await htmlToPageImages(await docxToHtml(f), fmt), base, fmt);
