import { beforeEach, describe, expect, it, vi } from "vitest";

// ambiente node do vitest: stub mínimo de localStorage/window pros helpers
const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
});
vi.stubGlobal("window", globalThis);

const {
  getFavorites,
  setFavorites,
  toggleFavorite,
  resolveFavorites,
  sortForConfig,
} = await import("./shareTargets");

const app = (packageName: string, label: string) => ({
  packageName,
  label,
  activityName: `${packageName}.Send`,
  icon: "",
});

beforeEach(() => store.clear());

describe("favoritos (localStorage)", () => {
  it("começa vazio e tolera JSON inválido", () => {
    expect(getFavorites()).toEqual([]);
    store.set("shareTargets.favorites", "{corrompido");
    expect(getFavorites()).toEqual([]);
  });

  it("toggle marca no fim (ordem de marcação) e desmarca", () => {
    toggleFavorite("com.drive");
    toggleFavorite("com.onedrive");
    expect(getFavorites()).toEqual(["com.drive", "com.onedrive"]);
    toggleFavorite("com.drive");
    expect(getFavorites()).toEqual(["com.onedrive"]);
  });

  it("resolveFavorites valida contra os apps existentes (desinstalado cai fora)", () => {
    setFavorites(["com.sumido", "com.drive"]);
    const apps = [app("com.drive", "Drive"), app("com.gmail", "Gmail")];
    expect(resolveFavorites(apps).map((a) => a.packageName)).toEqual(["com.drive"]);
  });
});

describe("sortForConfig", () => {
  it("favoritos no topo (ordem de marcação), demais em ordem alfabética", () => {
    setFavorites(["com.onedrive", "com.drive"]);
    const apps = [
      app("com.zap", "WhatsApp"),
      app("com.drive", "Drive"),
      app("com.acrobat", "Acrobat"),
      app("com.onedrive", "OneDrive"),
    ];
    expect(sortForConfig(apps).map((a) => a.label)).toEqual([
      "OneDrive", "Drive", "Acrobat", "WhatsApp",
    ]);
  });
});
