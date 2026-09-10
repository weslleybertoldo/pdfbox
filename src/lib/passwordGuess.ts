/**
 * Gerador de candidatos a senha para o Descobrir senha, ordenado do mais
 * provável/curto para o mais longo, parando cedo (o runner interrompe ao achar).
 *
 * Ordem: números do nome do arquivo → lista de senhas comuns → datas
 * (aaaa, ddmm, ddmmaa, ddmmaaaa) → força bruta numérica de 1 a `maxDigits`
 * dígitos (com zeros à esquerda). As datas/números de até `maxDigits` dígitos
 * também apareceriam na força bruta, então são tentadas ANTES e REMOVIDAS da
 * força bruta (sem trabalho repetido) — a contagem total reflete isso, pra
 * barra de progresso ser exata. Só ddmmaaaa (8 díg) fica além do teto de 6.
 */
export interface GuessPlan {
  maxDigits: number;
  fileName?: string;
}

// Senhas comuns (viés BR: muita fatura usa numérico simples)
const COMMON = [
  "123456", "12345678", "123456789", "000000", "111111", "123123", "102030",
  "112233", "123321", "654321", "121212", "789456", "159753", "147258",
  "abc123", "senha", "senha123", "1234", "12345", "1234567", "1234567890",
  "010203", "252525", "999999", "555555", "777777", "666666", "888888",
];

/** Sequências de dígitos presentes no nome do arquivo (ex.: "Fatura-3" → "3"). */
function fileNameTokens(fileName?: string): string[] {
  if (!fileName) return [];
  const base = fileName.replace(/\.[a-z0-9]+$/i, "");
  const nums = base.match(/\d{1,12}/g) ?? [];
  return [...new Set(nums)];
}

function dates(): string[] {
  const out: string[] = [];
  for (let y = 1930; y <= 2035; y++) out.push(String(y)); // aaaa
  for (let d = 1; d <= 31; d++)
    for (let m = 1; m <= 12; m++) {
      const dd = String(d).padStart(2, "0");
      const mm = String(m).padStart(2, "0");
      out.push(dd + mm); // ddmm
      for (let yy = 0; yy <= 99; yy++) out.push(dd + mm + String(yy).padStart(2, "0")); // ddmmaa
      for (let y = 1940; y <= 2025; y++) out.push(dd + mm + String(y)); // ddmmaaaa
    }
  return out;
}

/** Lista ordenada de candidatos "prioritários" (antes da força bruta), única. */
function priority(plan: GuessPlan): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of [...fileNameTokens(plan.fileName), ...COMMON, ...dates()]) {
    if (!seen.has(c)) { seen.add(c); out.push(c); }
  }
  return out;
}

/** Prioritários que são puramente numéricos com 1..maxDigits (colidem com o brute). */
function numericInBruteRange(prio: string[], maxDigits: number): Set<string> {
  const s = new Set<string>();
  for (const c of prio) if (/^\d+$/.test(c) && c.length <= maxDigits) s.add(c);
  return s;
}

/** Total exato de candidatos (denominador da barra de progresso). */
export function countCandidates(plan: GuessPlan): number {
  const prio = priority(plan);
  const skip = numericInBruteRange(prio, plan.maxDigits);
  let brute = 0;
  for (let len = 1; len <= plan.maxDigits; len++) brute += 10 ** len;
  return prio.length + brute - skip.size;
}

/** Candidatos em ordem, sem repetir trabalho entre prioritários e força bruta. */
export function* generateCandidates(plan: GuessPlan): Generator<string> {
  const prio = priority(plan);
  const skip = numericInBruteRange(prio, plan.maxDigits);
  for (const c of prio) yield c;
  for (let len = 1; len <= plan.maxDigits; len++) {
    const max = 10 ** len;
    for (let i = 0; i < max; i++) {
      const s = String(i).padStart(len, "0");
      if (!skip.has(s)) yield s;
    }
  }
}
