import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import {
  FileText, FileType, Image, Merge as MergeIcon, Minimize2, Scissors, Trash2,
  type LucideIcon,
} from "lucide-react";
import { setActionFile, type ActionFile } from "../lib/actionFile";

/** Tipo do arquivo aberto no viewer — define quais ações fazem sentido. */
export type ViewerFileKind = "pdf" | "image" | "docx";

interface ActionDef {
  label: string;
  route: string;
  icon: LucideIcon;
}

// Mesmos rótulos/ícones/rotas da Home — o sheet é um atalho pra elas.
// Anotar/Editar ficam de fora (já têm o lápis no header do viewer).
const ACTIONS: Record<ViewerFileKind, ActionDef[]> = {
  pdf: [
    { label: "PDF → Imagem", route: "/convert/pdf-to-image", icon: Image },
    { label: "PDF → Word", route: "/convert/pdf-to-word", icon: FileText },
    { label: "Comprimir PDF", route: "/compress/pdf", icon: Minimize2 },
    { label: "Dividir PDF", route: "/pages/split", icon: Scissors },
    { label: "Remover páginas", route: "/pages/remove", icon: Trash2 },
    { label: "Juntar PDFs", route: "/merge", icon: MergeIcon },
  ],
  image: [
    { label: "Imagem → PDF", route: "/convert/image-to-pdf", icon: FileType },
    { label: "Imagem → Word (OCR)", route: "/convert/image-to-word", icon: FileText },
    { label: "Comprimir Imagem", route: "/compress/image", icon: Minimize2 },
  ],
  docx: [
    { label: "Word → PDF", route: "/convert/word-to-pdf", icon: FileType },
    { label: "Word → Imagem", route: "/convert/word-to-image", icon: Image },
  ],
};

/**
 * Sheet de ações do viewer: lista as funções do app aplicáveis ao arquivo
 * aberto; tocar numa função entrega o arquivo via actionFile e navega pra
 * tela dela — que abre já com o arquivo carregado, sem picker. O trigger é
 * render-prop (mesmo padrão do ShareMenu).
 */
const ActionsMenu = ({ kind, file, children }: {
  kind: ViewerFileKind;
  file: ActionFile;
  children: (open: () => void) => ReactNode;
}) => {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  const go = (route: string) => {
    setOpen(false);
    setActionFile(file);
    navigate(route);
  };

  return (
    <>
      {children(() => setOpen(true))}
      {open &&
        createPortal(
          <div className="fixed inset-0 z-50" data-actions-menu>
            <button
              type="button"
              aria-label="Fechar"
              onClick={() => setOpen(false)}
              className="absolute inset-0 bg-black/60"
            />
            <div className="absolute bottom-0 inset-x-0 bg-slate-900 border-t border-slate-700 rounded-t-2xl p-4 space-y-2 max-w-lg mx-auto">
              <p className="text-sm font-medium pb-1 truncate">
                Usar este arquivo em…
                <span className="block text-xs text-slate-500 font-normal truncate">
                  {file.name}
                </span>
              </p>
              {ACTIONS[kind].map(({ label, route, icon: Icon }) => (
                <button
                  key={route}
                  type="button"
                  data-action-item={route}
                  onClick={() => go(route)}
                  className="w-full flex items-center gap-3 px-3 py-3 bg-slate-800 rounded-xl text-sm text-left active:bg-slate-700"
                >
                  <Icon size={18} className="text-blue-400 shrink-0" />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
};

export default ActionsMenu;
