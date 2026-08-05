import { Capacitor, registerPlugin } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { blobToBase64 } from "./mediaSaver";
import { shareBlob } from "./files";

/** Um app do aparelho que aceita receber arquivos (ACTION_SEND). */
export interface ShareTargetApp {
  label: string;
  packageName: string;
  activityName: string;
  /** PNG base64 sem prefixo data: (~96px); vazio = sem ícone (placeholder). */
  icon: string;
}

interface ShareTargetsPlugin {
  list(): Promise<{ apps: ShareTargetApp[] }>;
  shareTo(options: {
    packageName: string;
    activityName: string;
    /** caminhos no cache do app (aceita prefixo file://); 2+ = SEND_MULTIPLE */
    paths: string[];
    mimeType: string;
    fileName?: string;
  }): Promise<void>;
}

const ShareTargets = registerPlugin<ShareTargetsPlugin>("ShareTargets");

/**
 * MOCK PARA TESTES WEB (documentado): os harnesses Playwright definem
 * `window.__SHARE_TARGETS_MOCK__` (via addInitScript) com a MESMA interface
 * do plugin — lista fake de apps e shareTo que registra a chamada. Com o
 * mock presente, o fluxo "escolhido" fica disponível fora do Android e a UI
 * inteira (menu, config, favoritos) é validada headless. Sem mock e fora do
 * app nativo, só o "Compartilhar geral" (download web) existe.
 */
declare global {
  interface Window {
    __SHARE_TARGETS_MOCK__?: ShareTargetsPlugin;
  }
}

const impl = (): ShareTargetsPlugin | null => {
  if (window.__SHARE_TARGETS_MOCK__) return window.__SHARE_TARGETS_MOCK__;
  if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android") {
    return ShareTargets;
  }
  return null;
};

/** O compartilhamento escolhido está disponível? (Android nativo ou mock) */
export const shareTargetsAvailable = (): boolean => impl() !== null;

/** Lista os apps do aparelho que aceitam receber arquivos. */
export async function listShareTargets(): Promise<ShareTargetApp[]> {
  const p = impl();
  if (!p) return [];
  return (await p.list()).apps;
}

// ── Favoritos (persistência local) ──────────────────────────────────────────
const FAVORITES_KEY = "shareTargets.favorites";

/** packageNames favoritos, na ordem de marcação (a ordem de exibição). */
export function getFavorites(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(FAVORITES_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function setFavorites(packageNames: string[]): void {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(packageNames));
}

/** Marca/desmarca um app; devolve a lista atualizada (marcado vai pro fim). */
export function toggleFavorite(packageName: string): string[] {
  const favs = getFavorites();
  const next = favs.includes(packageName)
    ? favs.filter((p) => p !== packageName)
    : [...favs, packageName];
  setFavorites(next);
  return next;
}

/**
 * Favoritos que ainda existem no aparelho (apps desinstalados caem fora),
 * já resolvidos pra entrada completa e na ordem de marcação.
 */
export function resolveFavorites(apps: ShareTargetApp[]): ShareTargetApp[] {
  const byPkg = new Map(apps.map((a) => [a.packageName, a]));
  return getFavorites()
    .map((pkg) => byPkg.get(pkg))
    .filter((a): a is ShareTargetApp => a !== undefined);
}

/**
 * Ordem da tela de config: favoritos no topo (ordem de marcação),
 * demais em ordem alfabética.
 */
export function sortForConfig(apps: ShareTargetApp[]): ShareTargetApp[] {
  const favs = getFavorites();
  const rank = new Map(favs.map((pkg, i) => [pkg, i]));
  return [...apps].sort((a, b) => {
    const ra = rank.get(a.packageName);
    const rb = rank.get(b.packageName);
    if (ra !== undefined && rb !== undefined) return ra - rb;
    if (ra !== undefined) return -1;
    if (rb !== undefined) return 1;
    return a.label.localeCompare(b.label, "pt-BR", { sensitivity: "base" });
  });
}

// ── Payload e envio ──────────────────────────────────────────────────────────
/** O que compartilhar: blobs em memória OU arquivo já no cache nativo. */
export type SharePayload =
  | { kind: "blobs"; files: { blob: Blob; name: string }[] }
  | { kind: "path"; path: string; fileName: string; mimeType: string };

/** Compartilhar geral: chooser nativo (fluxo atual) / download no web. */
export async function shareGeneral(payload: SharePayload): Promise<void> {
  if (payload.kind === "path") {
    const { uri } = await Filesystem.getUri({
      path: payload.path.split("/").pop()!,
      directory: Directory.Cache,
    });
    await Share.share({ title: payload.fileName, files: [uri] });
    return;
  }
  for (const f of payload.files) await shareBlob(f.blob, f.name);
}

/**
 * Compartilhar escolhido: grava blob(s) no cache (mesmo esquema do shareBlob)
 * e dispara o ACTION_SEND direcionado pro app favorito — sem chooser.
 */
export async function shareToApp(
  app: ShareTargetApp,
  payload: SharePayload,
): Promise<void> {
  const p = impl();
  if (!p) throw new Error("Compartilhamento escolhido indisponível fora do app");
  if (payload.kind === "path") {
    await p.shareTo({
      packageName: app.packageName,
      activityName: app.activityName,
      paths: [payload.path],
      mimeType: payload.mimeType,
      fileName: payload.fileName,
    });
    return;
  }
  const paths: string[] = [];
  for (const f of payload.files) {
    if (Capacitor.isNativePlatform()) {
      const { uri } = await Filesystem.writeFile({
        path: f.name,
        data: await blobToBase64(f.blob),
        directory: Directory.Cache,
      });
      paths.push(uri);
    } else {
      paths.push(f.name); // mock web: sem cache nativo, o mock só registra
    }
  }
  const mime = payload.files[0]?.blob.type || "application/octet-stream";
  await p.shareTo({
    packageName: app.packageName,
    activityName: app.activityName,
    paths,
    mimeType: payload.files.every((f) => f.blob.type === payload.files[0].blob.type)
      ? mime
      : "*/*",
    fileName: payload.files[0]?.name,
  });
}
