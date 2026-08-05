import { Link } from "react-router-dom";
import {
  Eye, Image, FileText, FileType, Table2, Globe, Minimize2,
  Film, Merge as MergeIcon, Scissors, Trash2, Camera,
} from "lucide-react";
import FooterVersion from "../components/FooterVersion";

const ACTIONS = [
  { to: "/viewer", icon: Eye, label: "Abrir PDF/Word", desc: "Visualizar/editar" },
  { to: "/convert/pdf-to-image", icon: Image, label: "PDF → Imagem", desc: "PNG ou JPG" },
  { to: "/convert/pdf-to-word", icon: FileText, label: "PDF → Word", desc: "Texto + imagens" },
  { to: "/convert/image-to-pdf", icon: FileType, label: "Imagem → PDF", desc: "PNG/JPG/WebP" },
  { to: "/convert/image-to-word", icon: FileText, label: "Imagem → Word", desc: "OCR offline" },
  { to: "/convert/word-to-pdf", icon: FileType, label: "Word → PDF", desc: ".docx" },
  { to: "/convert/word-to-image", icon: Image, label: "Word → Imagem", desc: ".docx" },
  { to: "/convert/html-to-pdf", icon: Globe, label: "HTML → PDF/Imagem", desc: ".html" },
  { to: "/convert/xlsx-to-pdf", icon: Table2, label: "Excel → PDF/Imagem", desc: ".xlsx" },
  { to: "/compress/pdf", icon: Minimize2, label: "Comprimir PDF", desc: "Leve/Média/Forte" },
  { to: "/compress/image", icon: Minimize2, label: "Comprimir Imagem", desc: "Foto, PNG, JPG" },
  { to: "/compress/video", icon: Film, label: "Comprimir Vídeo", desc: "MP4 e outros" },
  { to: "/merge", icon: MergeIcon, label: "Juntar PDFs", desc: "2+ em 1" },
  { to: "/pages/split", icon: Scissors, label: "Dividir PDF", desc: "Separar páginas" },
  { to: "/pages/remove", icon: Trash2, label: "Remover páginas", desc: "Escolhe as que ficam" },
  { to: "/scan", icon: Camera, label: "Digitalizar", desc: "Foto → PDF c/ filtros" },
];

const Home = () => (
  <div className="min-h-full flex flex-col p-4 max-w-lg mx-auto">
    <h1 className="text-xl font-bold text-center py-4">PDFBox</h1>
    <div className="grid grid-cols-2 gap-3 flex-1">
      {ACTIONS.map(({ to, icon: Icon, label, desc }) => (
        <Link
          key={to + label}
          to={to}
          className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col gap-2 active:bg-slate-800 transition-colors"
        >
          <Icon size={22} className="text-blue-400" />
          <span className="text-sm font-medium">{label}</span>
          <span className="text-xs text-slate-500">{desc}</span>
        </Link>
      ))}
    </div>
    <FooterVersion />
  </div>
);
export default Home;
