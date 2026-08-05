import { useState, useEffect } from "react";
import { Download, X } from "lucide-react";
import { downloadAndInstall } from "../lib/apkUpdater";
import { isNewerVersion } from "../lib/version";

const CURRENT_VERSION = __APP_VERSION__;
// Busca a última release via GitHub API (funciona em repos privados e públicos)
const RELEASES_URL = "https://api.github.com/repos/weslleybertoldo/pdfbox/releases/latest";

interface VersionInfo {
  version: string;
  message: string;
  download_url: string;
}

const UpdateChecker = () => {
  const [update, setUpdate] = useState<VersionInfo | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [needsPerm, setNeedsPerm] = useState(false);

  const handleDownload = async () => {
    if (!update) return;
    setNeedsPerm(false);
    setProgress(0);
    try {
      const res = await downloadAndInstall(update.download_url, (p) => setProgress(p));
      if (res === "permission") setNeedsPerm(true);
      // Reseta a barra: se o usuário cancelar a tela "Instalar?" do sistema,
      // o botão "Baixar" reaparece pra tentar de novo (não fica travado em 100%).
      setProgress(null);
    } catch {
      setProgress(null);
    }
  };

  useEffect(() => {
    const checkUpdate = async () => {
      try {
        const res = await fetch(RELEASES_URL, { cache: "no-store" });
        if (!res.ok) return;
        const release = await res.json();

        // tag_name vem como "v1.0.1" — remove o "v"
        const remoteVersion = (release.tag_name || "").replace(/^v/, "");
        if (!remoteVersion) return;

        if (isNewerVersion(remoteVersion, CURRENT_VERSION)) {
          // Busca o link do APK nos assets da release
          const apkAsset = (release.assets || []).find(
            (a: { name: string }) => a.name.endsWith(".apk")
          );
          setUpdate({
            version: remoteVersion,
            message: "Nova versão disponível!",
            download_url: apkAsset
              ? apkAsset.browser_download_url
              : release.html_url,
          });
        }
      } catch {
        // Sem internet ou erro — ignora silenciosamente
      }
    };

    checkUpdate();
  }, []);

  if (!update || dismissed) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-md">
      <div className="bg-slate-900 border border-blue-700/50 rounded-xl p-4 shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <p className="text-sm text-slate-100">
              {update.message || "Nova versao disponivel!"}
            </p>
            <p className="text-xs text-slate-400 mt-1">
              v{CURRENT_VERSION} → v{update.version}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="p-1 text-slate-400 hover:text-slate-100 transition-colors"
          >
            <X size={16} />
          </button>
        </div>
        {progress !== null ? (
          <div className="mt-3">
            <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-600 transition-all duration-200"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-xs text-slate-400 mt-1 text-center">
              {progress < 100 ? `Baixando ${progress}%` : "Abrindo instalador..."}
            </p>
          </div>
        ) : (
          <>
            {needsPerm && (
              <p className="mt-2 text-xs text-slate-400">
                Permita "instalar apps desconhecidos" para o PDFBox nas
                configurações que abriram, depois toque em baixar novamente.
              </p>
            )}
            <button
              type="button"
              onClick={handleDownload}
              className="mt-3 w-full flex items-center justify-center gap-2 py-2 px-4 bg-blue-600 text-white rounded-lg text-xs uppercase tracking-wider hover:bg-blue-600/90 transition-colors"
            >
              <Download size={14} />
              {needsPerm ? "Tentar novamente" : "Baixar atualização"}
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export { CURRENT_VERSION };
export default UpdateChecker;
