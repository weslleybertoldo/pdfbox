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
import UpdateChecker from "./components/UpdateChecker";
import { addFileOpenedListener, getPendingFile, type ExternalFile } from "./lib/intentReceiver";
import { setOpenFile } from "./lib/openFileStore";

/**
 * Abre no Viewer arquivos vindos de ACTION_VIEW ("Abrir com → PDFBox"):
 * cold start (getPendingFile no mount) e app já aberto (evento fileOpened).
 */
const ExternalFileOpener = () => {
  const navigate = useNavigate();
  useEffect(() => {
    const open = (f: ExternalFile) => {
      setOpenFile(f);
      navigate("/viewer");
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
    </Routes>
    <UpdateChecker />
    <Toaster theme="dark" position="top-center" />
  </HashRouter>
);
export default App;
