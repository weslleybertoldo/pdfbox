import * as XLSX from "xlsx";
import { htmlToPageCanvases, canvasesToPdf, canvasesToImages } from "./htmlPipeline";

/** Cada aba vira uma tabela HTML; abas concatenadas com quebra visual. */
export async function xlsxToHtml(file: File): Promise<string> {
  const wb = XLSX.read(await file.arrayBuffer()); // fórmulas → valor calculado salvo
  return wb.SheetNames.map((name) => {
    const table = XLSX.utils.sheet_to_html(wb.Sheets[name], { id: name });
    return `<h3 style="font-family:sans-serif">${name}</h3>${table}`;
  }).join('<div style="height:40px"></div>');
}
export const xlsxToPdf = async (f: File) => canvasesToPdf(await htmlToPageCanvases(await xlsxToHtml(f)));
export const xlsxToImages = async (f: File, base: string, fmt: "png" | "jpg") =>
  canvasesToImages(await htmlToPageCanvases(await xlsxToHtml(f)), base, fmt);
