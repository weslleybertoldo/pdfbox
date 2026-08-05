import { Check } from "lucide-react";

/** Grid de miniaturas; toque alterna seleção (1-based). */
const PageGrid = ({ thumbs, selected, onToggle }: {
  thumbs: string[];
  selected: Set<number>;
  onToggle: (page: number) => void;
}) => (
  <div className="grid grid-cols-3 gap-2">
    {thumbs.map((src, i) => {
      const page = i + 1;
      const sel = selected.has(page);
      return (
        <button key={page} type="button" onClick={() => onToggle(page)}
          className={`relative rounded-lg overflow-hidden border-2 ${
            sel ? "border-blue-500" : "border-slate-800"}`}>
          <img src={src} alt={`Página ${page}`} className="w-full" />
          <span className="absolute bottom-1 left-1 text-[10px] bg-slate-950/80 px-1 rounded">
            {page}
          </span>
          {sel && (
            <span className="absolute top-1 right-1 bg-blue-600 rounded-full p-0.5">
              <Check size={12} />
            </span>
          )}
        </button>
      );
    })}
  </div>
);
export default PageGrid;
