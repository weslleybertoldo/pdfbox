export type FilterId = "original" | "scanBW" | "grayscale" | "enhance";

export const FILTERS: { id: FilterId; label: string }[] = [
  { id: "original", label: "Original" },
  { id: "scanBW", label: "P&B Digitalização" },
  { id: "grayscale", label: "Escala de cinza" },
  { id: "enhance", label: "Realce" },
];

const clamp = (v: number) => Math.max(0, Math.min(255, v));
const luma = (r: number, g: number, b: number) =>
  0.299 * r + 0.587 * g + 0.114 * b;

/** Aplica o filtro in-place num buffer RGBA e o retorna. */
export function applyFilter(data: Uint8ClampedArray, filter: FilterId): Uint8ClampedArray {
  if (filter === "original") return data;
  for (let i = 0; i < data.length; i += 4) {
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
    if (filter === "grayscale") {
      const y = luma(r, g, b);
      data[i] = data[i + 1] = data[i + 2] = y;
    } else if (filter === "scanBW") {
      // grayscale + curva sigmoide em torno de 160 → aparência de scanner
      const y = luma(r, g, b);
      const v = clamp(255 / (1 + Math.exp(-(y - 160) / 18)));
      data[i] = data[i + 1] = data[i + 2] = v;
    } else if (filter === "enhance") {
      // contraste 1.25 em torno de 128 + brilho +8
      for (let c = 0; c < 3; c++)
        data[i + c] = clamp((data[i + c] - 128) * 1.25 + 128 + 8);
    }
  }
  return data;
}
