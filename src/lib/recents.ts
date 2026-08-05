/**
 * Histórico de arquivos recentes por função (viewer, convert:<action>, merge,
 * pages, compress-pdf, compress-image).
 *
 * - Metadata em localStorage (`recents.<categoria>` = array de RecentMeta,
 *   mais novo primeiro).
 * - Bytes: no app nativo, Capacitor Filesystem em Directory.Data/recents/;
 *   na web/dev, IndexedDB (decisão: IndexedDB em vez de lista em memória —
 *   sobrevive a F5 e o custo é ~30 linhas).
 * - Dedup por nome+tamanho (atualiza ts e move pro topo, sem regravar bytes).
 * - Limites: MAX_PER_CATEGORY itens por categoria e MAX_TOTAL_BYTES globais
 *   com LRU entre categorias (ts mais antigo sai primeiro); eviction apaga
 *   o arquivo físico.
 *
 * A lógica é pura e recebe os storages por injeção (createRecents) — os
 * testes usam fakes em memória; o app usa o singleton com localStorage +
 * Filesystem/IndexedDB.
 */
import { Capacitor } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { blobToBase64 } from "./mediaSaver";

export interface RecentMeta {
  id: string;
  name: string;
  mime: string;
  size: number;
  ts: number;
}

export interface MetaStorage {
  get(category: string): RecentMeta[];
  set(category: string, list: RecentMeta[]): void;
  categories(): string[];
}

export interface BlobStorage {
  put(id: string, blob: Blob): Promise<void>;
  get(id: string): Promise<Blob | null>;
  remove(id: string): Promise<void>;
}

export const MAX_PER_CATEGORY = 10;
export const MAX_TOTAL_BYTES = 200 * 1024 * 1024; // ~200MB globais

interface RecentsOptions {
  maxPerCategory?: number;
  maxTotalBytes?: number;
  now?: () => number;
  newId?: () => string;
}

const defaultId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

export interface RecentsApi {
  addRecent(category: string, file: { name: string; mime: string; blob: Blob }): Promise<void>;
  listRecents(category: string): RecentMeta[];
  getRecentBlob(id: string): Promise<Blob | null>;
  removeRecent(category: string, id: string): Promise<void>;
  clearRecents(category: string): Promise<void>;
}

/** Fábrica com storages injetados — o app usa o singleton do fim do arquivo. */
export function createRecents(
  meta: MetaStorage,
  blobs: BlobStorage,
  opts: RecentsOptions = {},
): RecentsApi {
  const maxPerCategory = opts.maxPerCategory ?? MAX_PER_CATEGORY;
  const maxTotalBytes = opts.maxTotalBytes ?? MAX_TOTAL_BYTES;
  const now = opts.now ?? Date.now;
  const newId = opts.newId ?? defaultId;

  /** LRU global: evita ultrapassar maxTotalBytes removendo o ts mais antigo
   *  entre TODAS as categorias (nunca o item recém-adicionado, protectId). */
  const enforceBudget = async (protectId: string) => {
    const byCat = new Map<string, RecentMeta[]>(
      meta.categories().map((c) => [c, meta.get(c)]),
    );
    const total = () =>
      [...byCat.values()].reduce((s, l) => s + l.reduce((a, m) => a + m.size, 0), 0);
    const evicted: RecentMeta[] = [];
    while (total() > maxTotalBytes) {
      let oldest: { cat: string; m: RecentMeta } | null = null;
      for (const [cat, list] of byCat) {
        for (const m of list) {
          if (m.id === protectId) continue;
          if (!oldest || m.ts < oldest.m.ts) oldest = { cat, m };
        }
      }
      if (!oldest) break; // só resta o item protegido
      const rest = byCat.get(oldest.cat)!.filter((m) => m.id !== oldest.m.id);
      byCat.set(oldest.cat, rest);
      meta.set(oldest.cat, rest);
      evicted.push(oldest.m);
    }
    await Promise.all(evicted.map((m) => blobs.remove(m.id)));
  };

  const addRecent: RecentsApi["addRecent"] = async (category, file) => {
    try {
      const size = file.blob.size;
      const list = meta.get(category);
      const dup = list.find((m) => m.name === file.name && m.size === size);
      if (dup) {
        // dedup: mesmo nome+tamanho → atualiza ts e move pro topo (bytes já gravados)
        meta.set(category, [
          { ...dup, ts: now() },
          ...list.filter((m) => m.id !== dup.id),
        ]);
        return;
      }
      const entry: RecentMeta = { id: newId(), name: file.name, mime: file.mime, size, ts: now() };
      await blobs.put(entry.id, file.blob); // bytes primeiro: falhou → sem meta órfã
      const next = [entry, ...list];
      const evicted = next.splice(maxPerCategory); // além do limite da categoria
      meta.set(category, next);
      await Promise.all(evicted.map((m) => blobs.remove(m.id)));
      await enforceBudget(entry.id);
    } catch (e) {
      // histórico é best-effort: nunca derruba o fluxo principal
      console.warn("recents: falha ao registrar", e);
    }
  };

  const listRecents: RecentsApi["listRecents"] = (category) =>
    [...meta.get(category)].sort((a, b) => b.ts - a.ts);

  const getRecentBlob: RecentsApi["getRecentBlob"] = async (id) => {
    const blob = await blobs.get(id);
    if (!blob) return null;
    if (blob.type) return blob;
    // Filesystem devolve bytes sem MIME — reaplica o da metadata
    for (const c of meta.categories()) {
      const m = meta.get(c).find((x) => x.id === id);
      if (m) return new Blob([blob], { type: m.mime });
    }
    return blob;
  };

  const removeRecent: RecentsApi["removeRecent"] = async (category, id) => {
    meta.set(category, meta.get(category).filter((m) => m.id !== id));
    await blobs.remove(id).catch(() => {});
  };

  const clearRecents: RecentsApi["clearRecents"] = async (category) => {
    const list = meta.get(category);
    meta.set(category, []);
    await Promise.all(list.map((m) => blobs.remove(m.id).catch(() => {})));
  };

  return { addRecent, listRecents, getRecentBlob, removeRecent, clearRecents };
}

// ── Storage real: metadata em localStorage ───────────────────────────────────
const LS_PREFIX = "recents.";

const localStorageMeta: MetaStorage = {
  get(category) {
    try {
      const raw = localStorage.getItem(LS_PREFIX + category);
      const list: unknown = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? (list as RecentMeta[]) : [];
    } catch {
      return [];
    }
  },
  set(category, list) {
    if (list.length) localStorage.setItem(LS_PREFIX + category, JSON.stringify(list));
    else localStorage.removeItem(LS_PREFIX + category);
  },
  categories() {
    return Object.keys(localStorage)
      .filter((k) => k.startsWith(LS_PREFIX))
      .map((k) => k.slice(LS_PREFIX.length));
  },
};

// ── Storage real: bytes no Filesystem nativo (Directory.Data/recents/) ───────
const base64ToBlob = (b64: string): Blob => {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes]);
};

const nativeBlobs: BlobStorage = {
  async put(id, blob) {
    await Filesystem.writeFile({
      path: `recents/${id}`,
      data: await blobToBase64(blob),
      directory: Directory.Data,
      recursive: true,
    });
  },
  async get(id) {
    try {
      const { data } = await Filesystem.readFile({
        path: `recents/${id}`,
        directory: Directory.Data,
      });
      return typeof data === "string" ? base64ToBlob(data) : data;
    } catch {
      return null;
    }
  },
  async remove(id) {
    try {
      await Filesystem.deleteFile({ path: `recents/${id}`, directory: Directory.Data });
    } catch {
      /* já não existe */
    }
  },
};

// ── Storage real: bytes em IndexedDB (fallback web/dev) ──────────────────────
let dbPromise: Promise<IDBDatabase> | null = null;
const openDb = (): Promise<IDBDatabase> => {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open("pdfbox-recents", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("blobs");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexedDB open falhou"));
  });
  return dbPromise;
};
const idbRequest = async <T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> => {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const req = run(db.transaction("blobs", mode).objectStore("blobs"));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexedDB falhou"));
  });
};

const webBlobs: BlobStorage = {
  async put(id, blob) {
    await idbRequest("readwrite", (s) => s.put(blob, id));
  },
  async get(id) {
    const v = await idbRequest<unknown>("readonly", (s) => s.get(id));
    return v instanceof Blob ? v : null;
  },
  async remove(id) {
    await idbRequest("readwrite", (s) => s.delete(id));
  },
};

const recents = createRecents(
  localStorageMeta,
  Capacitor.isNativePlatform() ? nativeBlobs : webBlobs,
);

export const addRecent = recents.addRecent;
export const listRecents = recents.listRecents;
export const getRecentBlob = recents.getRecentBlob;
export const removeRecent = recents.removeRecent;
export const clearRecents = recents.clearRecents;

// hook de QA (só no dev server — tree-shaken do build de produção)
if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__recents = recents;
}
