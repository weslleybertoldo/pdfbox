import { loadPdf, destroyPdf, isPasswordError } from "./pdfRender";
import { getQpdf } from "./qpdf";
import { decryptWithQpdf } from "./qpdfDecrypt";

/**
 * Remover senha (tela /unlock e opção no dialog de senha do viewer).
 *
 * 1. Sonda a criptografia com o pdf.js, SEM senha: PasswordException → tem
 *    senha de usuário ("user"); abriu → `getPermissions()` devolve null quando
 *    não há /Encrypt ("none") e a lista de permissões quando há ("owner": só
 *    senha de dono — abre sem senha, mas segue cifrado e com restrições).
 * 2. Decifra com o qpdf (`--decrypt`, senha vazia no caso "owner"). A saída
 *    é um PDF livre de criptografia — a senha NÃO é guardada em lugar nenhum.
 */
export type EncryptionStatus = "none" | "owner" | "user";

export async function probeEncryption(bytes: Uint8Array): Promise<EncryptionStatus> {
  let doc;
  try {
    doc = await loadPdf(bytes);
  } catch (e) {
    if (isPasswordError(e)) return "user";
    throw e;
  }
  try {
    return (await doc.getPermissions()) === null ? "none" : "owner";
  } finally {
    void destroyPdf(doc);
  }
}

export type UnlockResult =
  | { status: "ok"; bytes: Uint8Array }
  | { status: "not-encrypted" }
  | { status: "needs-password"; wrong: boolean }
  | { status: "error"; message: string };

export async function unlockPdf(bytes: Uint8Array, password?: string): Promise<UnlockResult> {
  const enc = await probeEncryption(bytes);
  if (enc === "none") return { status: "not-encrypted" };
  if (enc === "user" && !password) return { status: "needs-password", wrong: false };
  const runner = await getQpdf();
  const r = decryptWithQpdf(runner, bytes, enc === "owner" ? "" : password ?? "");
  if (r.ok) return { status: "ok", bytes: r.bytes };
  if (r.reason === "wrong-password") return { status: "needs-password", wrong: true };
  return { status: "error", message: r.detail };
}

/** Nome da cópia livre: "fatura.pdf" → "fatura-sem-senha.pdf". */
export const unlockedName = (name: string): string =>
  `${name.replace(/\.pdf$/i, "")}-sem-senha.pdf`;
