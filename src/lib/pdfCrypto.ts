/**
 * Verificação de senha de USUÁRIO do "Standard Security Handler" do PDF, para
 * o recurso Descobrir senha. Só CHECA se uma senha abre o PDF (rápido, milhares
 * por segundo) — a remoção em si continua no qpdf (qpdfDecrypt.ts).
 *
 * Suporta os handlers reais de fatura/boleto:
 *  - V1/V2, R2/R3 (RC4 40/128 bits) e V4 R4 (RC4 ou AES-128): Algoritmos 2 e 6
 *    (chave via MD5, validação do /U via RC4) — ISO 32000-1.
 *  - V5 R6 (AES-256): Algoritmo 2.A/2.B (hash SHA-256/384/512 + AES-128-CBC) e
 *    R5 (variante transitória, SHA-256 único) — ISO 32000-2.
 *
 * Criptografia SÍNCRONA no browser (WebCrypto é assíncrona e não tem MD5): MD5
 * (spark-md5), SHA-2 (js-sha256/js-sha512), AES-128-CBC (aes-js), RC4 próprio.
 * Validado contra o qpdf (pdfCrypto.test.ts) em R2/R3/R4/R6 e na fatura real.
 */
import SparkMD5 from "spark-md5";
import { sha256 } from "js-sha256";
import { sha384, sha512 } from "js-sha512";
import aesjs from "aes-js";

const PADDING = new Uint8Array([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
  0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);

const bufOf = (u: Uint8Array): ArrayBuffer =>
  u.byteOffset === 0 && u.byteLength === u.buffer.byteLength
    ? (u.buffer as ArrayBuffer)
    : u.slice().buffer;

const md5 = (data: Uint8Array): Uint8Array => {
  const s = new SparkMD5.ArrayBuffer();
  s.append(bufOf(data));
  // end(true) devolve uma STRING binária (16 chars), não um ArrayBuffer
  return Uint8Array.from(s.end(true), (c) => c.charCodeAt(0) & 0xff);
};
const sha = (bits: 256 | 384 | 512, data: Uint8Array): Uint8Array =>
  new Uint8Array((bits === 256 ? sha256 : bits === 384 ? sha384 : sha512).arrayBuffer(data));

/** RC4 (ARCFOUR) — cifra de fluxo simétrica; usada na validação do /U em R2–R4. */
function rc4(key: Uint8Array, data: Uint8Array): Uint8Array {
  const S = new Uint8Array(256);
  for (let i = 0; i < 256; i++) S[i] = i;
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + S[i] + key[i % key.length]) & 255;
    const t = S[i]; S[i] = S[j]; S[j] = t;
  }
  const out = new Uint8Array(data.length);
  let a = 0, b = 0;
  for (let k = 0; k < data.length; k++) {
    a = (a + 1) & 255; b = (b + S[a]) & 255;
    const t = S[a]; S[a] = S[b]; S[b] = t;
    out[k] = data[k] ^ S[(S[a] + S[b]) & 255];
  }
  return out;
}

const aes128cbcNoPad = (key: Uint8Array, iv: Uint8Array, data: Uint8Array): Uint8Array =>
  new aesjs.ModeOfOperation.cbc(key, iv).encrypt(data);

const concat = (...arrs: Uint8Array[]): Uint8Array => {
  const total = arrs.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrs) { out.set(a, off); off += a.length; }
  return out;
};

const eq = (a: Uint8Array, b: Uint8Array, n: number): boolean => {
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return false;
  return true;
};

// ── Parse do dicionário /Encrypt ────────────────────────────────────────────
export interface EncryptionInfo {
  v: number;
  r: number;
  keyBytes: number; // tamanho da chave (n)
  o: Uint8Array;
  u: Uint8Array;
  p: number; // signed 32-bit
  id: Uint8Array; // 1º elemento do /ID (vazio se ausente)
  encryptMetadata: boolean;
}

/** Lê uma string PDF literal `(...)` ou hexadecimal `<...>` a partir do byte i. */
function readPdfString(buf: Uint8Array, i: number): Uint8Array {
  if (buf[i] === 0x3c) {
    let j = i + 1;
    let hex = "";
    while (j < buf.length && buf[j] !== 0x3e) {
      const c = String.fromCharCode(buf[j]);
      if (/[0-9a-fA-F]/.test(c)) hex += c;
      j++;
    }
    if (hex.length % 2) hex += "0";
    const out = new Uint8Array(hex.length / 2);
    for (let k = 0; k < out.length; k++) out[k] = parseInt(hex.substr(k * 2, 2), 16);
    return out;
  }
  let j = i + 1;
  let depth = 1;
  const out: number[] = [];
  const esc: Record<number, number> = { 0x6e: 10, 0x72: 13, 0x74: 9, 0x62: 8, 0x66: 12, 0x28: 40, 0x29: 41, 0x5c: 92 };
  while (j < buf.length && depth > 0) {
    const c = buf[j];
    if (c === 0x5c) {
      const nx = buf[j + 1];
      if (nx in esc) { out.push(esc[nx]); j += 2; }
      else if (nx >= 0x30 && nx <= 0x37) {
        let o = "";
        let k = j + 1;
        while (k < j + 4 && buf[k] >= 0x30 && buf[k] <= 0x37) { o += String.fromCharCode(buf[k]); k++; }
        out.push(parseInt(o, 8) & 255); j = k;
      } else if (nx === 10) { j += 2; }
      else { out.push(nx); j += 2; }
    } else if (c === 0x28) { depth++; out.push(c); j++; }
    else if (c === 0x29) { depth--; if (depth > 0) out.push(c); j++; }
    else { out.push(c); j++; }
  }
  return new Uint8Array(out);
}

/** Índice (byte) do valor string da chave `key` dentro de [start,end). */
function keyStringBytes(buf: Uint8Array, latin: string, start: number, end: number, key: string): Uint8Array | null {
  const at = latin.indexOf(key, start);
  if (at < 0 || at >= end) return null;
  let i = at + key.length;
  while (i < end && (buf[i] === 0x20 || buf[i] === 0x0a || buf[i] === 0x0d || buf[i] === 0x09)) i++;
  if (buf[i] !== 0x28 && buf[i] !== 0x3c) return null;
  return readPdfString(buf, i);
}

/** Lê o /Encrypt do PDF; devolve null se não for Standard handler suportado. */
export function parseEncryption(bytes: Uint8Array): EncryptionInfo | null {
  try {
    const latin = Array.from(bytes, (b) => String.fromCharCode(b)).join("");
    const ref = latin.match(/\/Encrypt\s+(\d+)\s+\d+\s+R/);
    let start: number, end: number;
    if (ref) {
      const om = latin.match(new RegExp("(?:^|[^0-9])" + ref[1] + "\\s+0\\s+obj"));
      if (!om) return null;
      start = (om.index ?? 0);
      end = latin.indexOf("endobj", start);
      if (end < 0) end = Math.min(latin.length, start + 2000);
    } else {
      start = latin.indexOf("/Encrypt");
      if (start < 0) return null;
      end = Math.min(latin.length, start + 2000);
    }
    const dict = latin.slice(start, end);
    if (!/\/Filter\s*\/Standard/.test(dict)) return null; // só o Standard handler
    const v = parseInt((dict.match(/\/V\s+(\d+)/) || [])[1] || "0", 10);
    const r = parseInt((dict.match(/\/R\s+(\d+)/) || [])[1] || "0", 10);
    // No V4 há vários /Length: o do crypt filter (/CF … /Length 16 = BYTES) e o
    // do handler (/Length 128 = BITS). O tamanho da chave é o em bits (>=40);
    // pega o último que se qualifica (o de topo vem depois do bloco /CF).
    const lens = [...dict.matchAll(/\/Length\s+(\d+)/g)]
      .map((m) => parseInt(m[1], 10))
      .filter((n) => n >= 40 && n <= 256 && n % 8 === 0);
    const len = lens.length ? lens[lens.length - 1] : 40;
    const p = parseInt((dict.match(/\/P\s+(-?\d+)/) || [])[1] || "0", 10);
    const encryptMetadata = !/\/EncryptMetadata\s+false/.test(dict);
    const o = keyStringBytes(bytes, latin, start, end, "/O");
    const u = keyStringBytes(bytes, latin, start, end, "/U");
    if (!o || !u) return null;
    // /ID (trailer): primeiro elemento do array
    let id: Uint8Array = new Uint8Array(0);
    const idAt = latin.lastIndexOf("/ID");
    if (idAt >= 0) {
      let i = idAt + 3;
      while (i < bytes.length && bytes[i] !== 0x5b && bytes[i] !== 0x28 && bytes[i] !== 0x3c) i++;
      if (bytes[i] === 0x5b) i++;
      while (i < bytes.length && (bytes[i] === 0x20 || bytes[i] === 0x0a || bytes[i] === 0x0d)) i++;
      if (bytes[i] === 0x28 || bytes[i] === 0x3c) id = readPdfString(bytes, i);
    }
    if (r < 2 || r > 6 || (r <= 4 && o.length < 32)) return null;
    return { v, r, keyBytes: r === 2 ? 5 : Math.min(16, len / 8) || 5, o, u, p, id, encryptMetadata };
  } catch {
    return null;
  }
}

// ── Verificação da senha de usuário ─────────────────────────────────────────
const encodeLatin1 = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);
const encodeUtf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

/** Algoritmo 2.B (R6). udata vazio para validação da senha de usuário. */
function hash2B(pw: Uint8Array, salt: Uint8Array, udata: Uint8Array): Uint8Array {
  let k = sha(256, concat(pw, salt, udata));
  for (let round = 0; ; round++) {
    const block = concat(pw, k, udata);
    const k1 = new Uint8Array(block.length * 64);
    for (let i = 0; i < 64; i++) k1.set(block, i * block.length);
    const e = aes128cbcNoPad(k.subarray(0, 16), k.subarray(16, 32), k1);
    let sum = 0;
    for (let i = 0; i < 16; i++) sum += e[i];
    const mod = sum % 3;
    k = sha(mod === 0 ? 256 : mod === 1 ? 384 : 512, e);
    if (round >= 63 && e[e.length - 1] <= round - 32) break;
  }
  return k.subarray(0, 32);
}

/**
 * Constrói um verificador rápido `(senha) => bool` para o /Encrypt dado.
 * Retorna null se o handler não puder ser verificado (degrada pra digitação
 * manual). Reaproveita o que é fixo (padding, baseU) entre as chamadas.
 */
export function makeUserPasswordChecker(info: EncryptionInfo): ((password: string) => boolean) | null {
  if (info.r >= 5) {
    if (info.u.length < 48) return null;
    const hashU = info.u.subarray(0, 32);
    const validationSalt = info.u.subarray(32, 40);
    const empty = new Uint8Array(0);
    return (password: string) => {
      const pw = encodeUtf8(password).subarray(0, 127);
      const h = info.r === 5 ? sha(256, concat(pw, validationSalt)) : hash2B(pw, validationSalt, empty);
      return eq(h, hashU, 32);
    };
  }
  // R2/R3/R4 — Algoritmo 2 (chave) + Algoritmo 6 (validação do /U)
  const n = info.keyBytes;
  const pBuf = new Uint8Array(4);
  new DataView(pBuf.buffer).setInt32(0, info.p | 0, true); // little-endian
  const ffff = new Uint8Array([0xff, 0xff, 0xff, 0xff]);
  const baseU = md5(concat(PADDING, info.id)); // Algoritmo 5 (R3+)
  const uHead = info.u.subarray(0, 16);
  return (password: string) => {
    const pwBytes = encodeLatin1(password);
    const pwPad = concat(pwBytes, PADDING).subarray(0, 32);
    let seed = concat(pwPad, info.o, pBuf, info.id);
    if (info.r >= 4 && !info.encryptMetadata) seed = concat(seed, ffff);
    let key = md5(seed).subarray(0, n);
    if (info.r >= 3) {
      for (let i = 0; i < 50; i++) key = md5(key.subarray(0, n)).subarray(0, n);
    }
    key = key.subarray(0, n);
    if (info.r === 2) {
      // Algoritmo 4: U = RC4(key, PADDING); compara 32 bytes
      return eq(rc4(key, PADDING), info.u, 32);
    }
    // Algoritmo 5: RC4 encadeado 20x; compara os 16 primeiros bytes
    let u = rc4(key, baseU);
    const kx = new Uint8Array(n);
    for (let i = 1; i <= 19; i++) {
      for (let b = 0; b < n; b++) kx[b] = key[b] ^ i;
      u = rc4(kx, u);
    }
    return eq(u, uHead, 16);
  };
}

/** Atalho: constrói o verificador direto dos bytes do PDF (ou null). */
export function makePasswordChecker(bytes: Uint8Array): ((password: string) => boolean) | null {
  const info = parseEncryption(bytes);
  return info ? makeUserPasswordChecker(info) : null;
}
