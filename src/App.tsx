import { useEffect } from "react";
import { HashRouter, Routes, Route, useNavigate } from "react-router-dom";
import { Toaster } from "sonner";
import Home from "./screens/Home";
import Viewer from "./screens/Viewer";
import Convert from "./screens/Convert";
import Merge from "./screens/Merge";
import SplitRemove from "./screens/SplitRemove";
import Scan from "./screens/Scan";
import CompressPdf from "./screens/CompressPdf";
import CompressImage from "./screens/CompressImage";
import CompressVideo from "./screens/CompressVideo";
import Unlock from "./screens/Unlock";
import UpdateChecker from "./components/UpdateChecker";
import AndroidBack from "./components/AndroidBack";
import { EXTERNAL_ENTRY_STATE } from "./lib/backAction";
import { ehPlay } from "./lib/distribuicao";
import { addFileOpenedListener, getPendingFile, type ExternalFile } from "./lib/intentReceiver";
import { setOpenFile } from "./lib/openFileStore";

/**
 * Abre no Viewer arquivos vindos de outro app ("Abrir com" ou Compartilhar →
 * PDFBox): cold start (getPendingFile no mount) e app já aberto (evento
 * fileOpened). A entrada ganha a marca de "aberta por outro app": o voltar
 * dali pergunta "Deseja sair?" e volta pro app que mandou o arquivo.
 */
const ExternalFileOpener = () => {
  const navigate = useNavigate();
  useEffect(() => {
    const open = (f: ExternalFile) => {
      setOpenFile(f);
      navigate("/viewer", { state: EXTERNAL_ENTRY_STATE });
    };
    void getPendingFile().then((f) => {
      if (f) open(f);
    });
    addFileOpenedListener(open);
  }, [navigate]);
  return null;
};

const App = () => (
  <HashRouter>
    <ExternalFileOpener />
    <AndroidBack />
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/viewer" element={<Viewer />} />
      <Route path="/convert/:action" element={<Convert />} />
      <Route path="/merge" element={<Merge />} />
      <Route path="/pages/:mode" element={<SplitRemove />} />
      <Route path="/scan" element={<Scan />} />
      <Route path="/compress/pdf" element={<CompressPdf />} />
      <Route path="/compress/image" element={<CompressImage />} />
      <Route path="/compress/video" element={<CompressVideo />} />
      <Route path="/unlock" element={<Unlock />} />
    </Routes>
    {/* banner de atualização só no APK do site — a Google Play atualiza sozinha */}
    {!ehPlay() && <UpdateChecker />}
    <Toaster theme="dark" position="top-center" />
  </HashRouter>
);
export default App;
