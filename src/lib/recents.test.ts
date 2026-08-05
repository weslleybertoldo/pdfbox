import { describe, it, expect } from "vitest";
import {
  createRecents,
  exceedsFileCap,
  MAX_FILE_BYTES,
  type BlobStorage,
  type MetaStorage,
  type RecentMeta,
} from "./recents";

/** Fakes em memória — a lógica de recents é testada por injeção de storage. */
const makeMetaStore = () => {
  const m = new Map<string, RecentMeta[]>();
  const store: MetaStorage = {
    get: (c) => m.get(c) ?? [],
    set: (c, list) => {
      if (list.length) m.set(c, list);
      else m.delete(c);
    },
    categories: () => [...m.keys()],
  };
  return store;
};

const makeBlobStore = () => {
  const blobs = new Map<string, Blob>();
  const store: BlobStorage = {
    put: async (id, blob) => void blobs.set(id, blob),
    get: async (id) => blobs.get(id) ?? null,
    remove: async (id) => void blobs.delete(id),
  };
  return { store, blobs };
};

const makeRecents = (
  opts: { maxPerCategory?: number; maxTotalBytes?: number; maxFileBytes?: number } = {},
) => {
  let tick = 0;
  let seq = 0;
  const meta = makeMetaStore();
  const { store: blobStore, blobs } = makeBlobStore();
  const api = createRecents(meta, blobStore, {
    ...opts,
    now: () => ++tick,
    newId: () => `id-${++seq}`,
  });
  return { api, blobs };
};

const file = (name: string, bytes: number, mime = "application/pdf") => ({
  name,
  mime,
  blob: new Blob([new Uint8Array(bytes)], { type: mime }),
});

describe("recents: ordenação", () => {
  it("lista mais novo primeiro", async () => {
    const { api } = makeRecents();
    await api.addRecent("viewer", file("a.pdf", 10));
    await api.addRecent("viewer", file("b.pdf", 20));
    await api.addRecent("viewer", file("c.pdf", 30));
    expect(api.listRecents("viewer").map((m) => m.name)).toEqual(["c.pdf", "b.pdf", "a.pdf"]);
  });

  it("categorias são independentes", async () => {
    const { api } = makeRecents();
    await api.addRecent("viewer", file("a.pdf", 10));
    await api.addRecent("merge", file("b.pdf", 20));
    expect(api.listRecents("viewer")).toHaveLength(1);
    expect(api.listRecents("merge")).toHaveLength(1);
    expect(api.listRecents("compress-pdf")).toHaveLength(0);
  });
});

describe("recents: dedup por nome+tamanho", () => {
  it("mesmo arquivo 2x → 1 item, ts atualizado, movido pro topo", async () => {
    const { api, blobs } = makeRecents();
    await api.addRecent("viewer", file("a.pdf", 10));
    await api.addRecent("viewer", file("b.pdf", 20));
    await api.addRecent("viewer", file("a.pdf", 10)); // repetido
    const list = api.listRecents("viewer");
    expect(list).toHaveLength(2);
    expect(list[0].name).toBe("a.pdf");
    expect(list[0].ts).toBe(3); // ts do reuso, não do add original
    expect(list[0].id).toBe("id-1"); // mantém o id (bytes não regravados)
    expect(blobs.size).toBe(2);
  });

  it("mesmo nome com tamanho diferente NÃO deduplica", async () => {
    const { api } = makeRecents();
    await api.addRecent("viewer", file("a.pdf", 10));
    await api.addRecent("viewer", file("a.pdf", 11));
    expect(api.listRecents("viewer")).toHaveLength(2);
  });
});

describe("recents: eviction por categoria", () => {
  it("12 itens → mantém 10, os 2 mais antigos saem e os bytes são apagados", async () => {
    const { api, blobs } = makeRecents();
    for (let i = 1; i <= 12; i++) await api.addRecent("viewer", file(`f${i}.pdf`, i));
    const list = api.listRecents("viewer");
    expect(list).toHaveLength(10);
    expect(list[0].name).toBe("f12.pdf");
    expect(list.at(-1)?.name).toBe("f3.pdf"); // f1 e f2 evictados
    expect(blobs.size).toBe(10);
    expect(blobs.has("id-1")).toBe(false);
    expect(blobs.has("id-2")).toBe(false);
  });
});

describe("recents: cap global de bytes (LRU entre categorias)", () => {
  it("estourou o cap → remove os ts mais antigos de QUALQUER categoria", async () => {
    const { api, blobs } = makeRecents({ maxTotalBytes: 100 });
    await api.addRecent("viewer", file("v1.pdf", 40)); // ts=1
    await api.addRecent("merge", file("m1.pdf", 40)); // ts=2
    await api.addRecent("viewer", file("v2.pdf", 40)); // ts=3 → total 120 → evicta v1
    expect(api.listRecents("viewer").map((m) => m.name)).toEqual(["v2.pdf"]);
    expect(api.listRecents("merge").map((m) => m.name)).toEqual(["m1.pdf"]);
    expect(blobs.has("id-1")).toBe(false);
  });

  it("item recém-adicionado maior que o cap fica sozinho (nunca se auto-evicta)", async () => {
    const { api } = makeRecents({ maxTotalBytes: 100 });
    await api.addRecent("viewer", file("v1.pdf", 40));
    await api.addRecent("merge", file("grande.pdf", 150));
    expect(api.listRecents("viewer")).toHaveLength(0);
    expect(api.listRecents("merge").map((m) => m.name)).toEqual(["grande.pdf"]);
  });
});

describe("recents: getRecentBlob / removeRecent / clearRecents", () => {
  it("getRecentBlob devolve os bytes com o MIME da metadata", async () => {
    const { api, blobs } = makeRecents();
    await api.addRecent("viewer", file("a.pdf", 10));
    // simula storage que perde o type (Filesystem nativo devolve bytes puros)
    blobs.set("id-1", new Blob([new Uint8Array(10)]));
    const blob = await api.getRecentBlob("id-1");
    expect(blob?.size).toBe(10);
    expect(blob?.type).toBe("application/pdf");
  });

  it("getRecentBlob de id inexistente → null", async () => {
    const { api } = makeRecents();
    expect(await api.getRecentBlob("nao-existe")).toBeNull();
  });

  it("removeRecent tira o item e apaga os bytes", async () => {
    const { api, blobs } = makeRecents();
    await api.addRecent("viewer", file("a.pdf", 10));
    await api.removeRecent("viewer", "id-1");
    expect(api.listRecents("viewer")).toHaveLength(0);
    expect(blobs.size).toBe(0);
  });

  it("clearRecents esvazia a categoria e apaga os bytes", async () => {
    const { api, blobs } = makeRecents();
    await api.addRecent("viewer", file("a.pdf", 10));
    await api.addRecent("viewer", file("b.pdf", 20));
    await api.addRecent("merge", file("c.pdf", 30));
    await api.clearRecents("viewer");
    expect(api.listRecents("viewer")).toHaveLength(0);
    expect(api.listRecents("merge")).toHaveLength(1);
    expect(blobs.size).toBe(1);
  });
});

describe("recents: teto por arquivo (MAX_FILE_BYTES)", () => {
  it("exceedsFileCap: decide o skip no limite exato", () => {
    expect(exceedsFileCap(100, 100)).toBe(false); // no teto → entra
    expect(exceedsFileCap(101, 100)).toBe(true); // acima → skip
    expect(MAX_FILE_BYTES).toBe(30 * 1024 * 1024); // 30MB (default do app)
    expect(exceedsFileCap(MAX_FILE_BYTES)).toBe(false);
    expect(exceedsFileCap(MAX_FILE_BYTES + 1)).toBe(true);
  });

  it("blob acima do teto → skip silencioso: sem meta, sem bytes", async () => {
    const { api, blobs } = makeRecents({ maxFileBytes: 100 });
    await expect(api.addRecent("viewer", file("grande.pdf", 101))).resolves.toBeUndefined();
    expect(api.listRecents("viewer")).toHaveLength(0);
    expect(blobs.size).toBe(0);
  });

  it("blob no teto exato entra normalmente", async () => {
    const { api, blobs } = makeRecents({ maxFileBytes: 100 });
    await api.addRecent("viewer", file("justo.pdf", 100));
    expect(api.listRecents("viewer").map((m) => m.name)).toEqual(["justo.pdf"]);
    expect(blobs.size).toBe(1);
  });

  it("skip do gigante não mexe nos itens já registrados", async () => {
    const { api } = makeRecents({ maxFileBytes: 100 });
    await api.addRecent("viewer", file("a.pdf", 10));
    await api.addRecent("viewer", file("grande.pdf", 500));
    expect(api.listRecents("viewer").map((m) => m.name)).toEqual(["a.pdf"]);
  });
});

describe("recents: robustez", () => {
  it("falha ao gravar bytes → não deixa metadata órfã nem derruba o fluxo", async () => {
    const meta = makeMetaStore();
    const failing: BlobStorage = {
      put: async () => {
        throw new Error("disco cheio");
      },
      get: async () => null,
      remove: async () => {},
    };
    const api = createRecents(meta, failing);
    await expect(api.addRecent("viewer", file("a.pdf", 10))).resolves.toBeUndefined();
    expect(api.listRecents("viewer")).toHaveLength(0);
  });
});
