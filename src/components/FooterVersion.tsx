import { useState } from "react";
import { Check, Download, RefreshCw } from "lucide-react";
import { CURRENT_VERSION } from "./UpdateChecker";
import { isNewerVersion } from "../lib/version";
import { downloadAndInstall } from "../lib/apkUpdater";

type Result = { hasUpdate: boolean; url?: string; version?: string };

const FooterVersion = () => {
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [needsPerm, setNeedsPerm] = useState(false);

  const handleCheck = async () => {
    setChecking(true);
    setResult(null);
    try {
      const res = await fetch(
        "https://api.github.com/repos/weslleybertoldo/pdfbox/releases/latest",
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error();
      const release = await res.json();
      const remote = (release.tag_name || "").replace(/^v/, "");
      if (isNewerVersion(remote, CURRENT_VERSION)) {
        const apk = (release.assets || []).find((a: { name: string }) => a.name.endsWith(".apk"));
        setResult({ hasUpdate: true, url: apk?.browser_download_url || release.html_url, version: remote });
      } else setResult({ hasUpdate: false });
    } catch {
      setResult({ hasUpdate: false });
    } finally {
      setChecking(false);
    }
  };

  const handleDownload = async () => {
    if (!result?.url) return;
    setNeedsPerm(false);
    setProgress(0);
    try {
      const r = await downloadAndInstall(result.url, setProgress);
      if (r === "permission") setNeedsPerm(true);
    } finally {
      setProgress(null);
    }
  };

  return (
    <footer className="py-4 text-center space-y-1">
      <p className="text-[10px] text-slate-500">v{CURRENT_VERSION}</p>
      <button
        type="button"
        onClick={handleCheck}
        disabled={checking}
        className="flex items-center justify-center gap-1 mx-auto text-[10px] text-slate-500 hover:text-blue-400 transition-colors"
      >
        <RefreshCw size={10} className={checking ? "animate-spin" : ""} />
        Verificar atualizações
      </button>
      {result && (
        <div>
          {result.hasUpdate ? (
            progress !== null ? (
              <div className="max-w-[200px] mx-auto">
                <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-500 transition-all" style={{ width: `${progress}%` }} />
                </div>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  {progress < 100 ? `Baixando ${progress}%` : "Abrindo instalador..."}
                </p>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleDownload}
                className="inline-flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-[10px] uppercase tracking-wider"
              >
                <Download size={10} />
                {needsPerm ? "Tentar novamente" : `Baixar v${result.version}`}
              </button>
            )
          ) : (
            <p className="text-[10px] text-green-400 flex items-center justify-center gap-1">
              <Check size={10} /> Versão mais recente
            </p>
          )}
        </div>
      )}
    </footer>
  );
};

export default FooterVersion;
