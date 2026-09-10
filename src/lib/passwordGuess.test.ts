import { describe, it, expect } from "vitest";
import { countCandidates, generateCandidates, type GuessPlan } from "./passwordGuess";
import { findPassword } from "./passwordCrack";

const collect = (plan: GuessPlan, limit = Infinity): string[] => {
  const out: string[] = [];
  for (const c of generateCandidates(plan)) {
    out.push(c);
    if (out.length >= limit) break;
  }
  return out;
};

describe("passwordGuess", () => {
  it("countCandidates bate EXATAMENTE com o que o gerador produz", () => {
    for (const maxDigits of [1, 2, 3, 4]) {
      const plan = { maxDigits, fileName: "Fatura-3.pdf" };
      expect(collect(plan).length).toBe(countCandidates(plan));
    }
  });

  it("não repete nenhum candidato (prioritários × força bruta deduplicados)", () => {
    const plan = { maxDigits: 4, fileName: "Conta_2020.pdf" };
    const all = collect(plan);
    expect(new Set(all).size).toBe(all.length);
  });

  it("tenta números do nome do arquivo e senhas comuns bem no começo", () => {
    const head = collect({ maxDigits: 6, fileName: "Fatura-777.pdf" }, 40);
    expect(head).toContain("777");
    expect(head).toContain("123456");
  });

  it("cobre datas de 8 dígitos (ddmmaaaa) que passam do teto de 6", () => {
    const all = new Set(collect({ maxDigits: 6, fileName: undefined }));
    expect(all.has("25111990")).toBe(true); // 25/11/1990
    expect(all.has("01012000")).toBe(true);
  });

  it("força bruta cobre todo o espaço de N dígitos com zeros à esquerda", () => {
    const all = new Set(collect({ maxDigits: 3 }));
    for (const s of ["0", "00", "000", "007", "042", "999"]) expect(all.has(s)).toBe(true);
  });

  it("6 dígitos ≈ 1,1 milhão de candidatos", () => {
    const total = countCandidates({ maxDigits: 6 });
    expect(total).toBeGreaterThan(1_000_000);
    expect(total).toBeLessThan(1_200_000);
  });
});

describe("findPassword", () => {
  it("acha uma senha numérica de 5 dígitos e reporta progresso", async () => {
    const secret = "12323";
    const check = (pw: string) => pw === secret;
    let lastTried = 0;
    const res = await findPassword(check, { maxDigits: 6 }, { onProgress: (t) => { lastTried = t; } });
    expect(res.password).toBe(secret);
    expect(res.cancelled).toBe(false);
    expect(lastTried).toBeGreaterThanOrEqual(0);
  });

  it("acha uma data ddmmaaaa (8 díg) mesmo com teto de 6", async () => {
    const res = await findPassword((pw) => pw === "25111990", { maxDigits: 6 });
    expect(res.password).toBe("25111990");
  });

  it("respeita o cancelamento (AbortSignal) e para", async () => {
    const ac = new AbortController();
    // yieldMs baixo garante um tick de progresso cedo; aborta no primeiro
    const res = await findPassword(() => false, { maxDigits: 6 }, {
      signal: ac.signal,
      yieldMs: 1,
      onProgress: () => ac.abort(),
    });
    expect(res.cancelled).toBe(true);
    expect(res.password).toBeNull();
  });

  it("senha fora do espaço → não encontrada", async () => {
    const res = await findPassword((pw) => pw === "naoexiste", { maxDigits: 2 });
    expect(res.password).toBeNull();
    expect(res.cancelled).toBe(false);
  });
});
