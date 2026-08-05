import { HashRouter, Routes, Route } from "react-router-dom";
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

const App = () => (
  <HashRouter>
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
