import { htmlToPageImages, pageImagesToPdf, pageImagesToFiles } from "./htmlPipeline";

export const htmlFileToPdf = async (f: File) => pageImagesToPdf(await htmlToPageImages(await f.text()));
export const htmlFileToImages = async (f: File, base: string, fmt: "png" | "jpg") =>
  pageImagesToFiles(await htmlToPageImages(await f.text(), fmt), base, fmt);
