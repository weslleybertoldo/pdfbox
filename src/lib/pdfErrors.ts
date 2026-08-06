/**
 * Erros de PDF protegido por senha — helpers compartilhados entre o viewer
 * (prompt de senha + retry) e as conversões/ações (mensagem amigável, sem
 * prompt). Módulo SEM dependência do pdfjs-dist de propósito: os caminhos
 * pdf-lib puros (pdfOps/compress leve/anotar) e os testes em Node usam estes
 * helpers sem carregar o pdf.js (que importa o worker via `?url`).
 */

/** Códigos do `pdfjs.PasswordResponses` (validados contra o pdfjs-dist
 *  instalado em pdfErrors.test.ts — se o upstream mudar, o teste quebra). */
export const NEED_PASSWORD = 1;
export const INCORRECT_PASSWORD = 2;

/** Erro de senha: o `PasswordException` do pdf.js (loadPdf de PDF protegido)
 *  ou o equivalente nosso dos caminhos pdf-lib (passwordProtectedError). */
export const isPasswordError = (err: unknown): boolean =>
  (err as { name?: string } | null)?.name === "PasswordException";

/** Senha fornecida mas incorreta (code 2) — retry no dialog do viewer. */
export const isWrongPasswordError = (err: unknown): boolean =>
  isPasswordError(err) && (err as { code?: number }).code === INCORRECT_PASSWORD;

/** Mensagem única das conversões/ações quando o PDF é protegido (o prompt de
 *  senha existe SÓ no viewer — ver decisão documentada em actionFile.ts). */
export const PASSWORD_PROTECTED_MSG =
  "PDF protegido por senha — abra no visualizador e informe a senha";

/**
 * Erro "protegido por senha" pros caminhos pdf-lib (merge/split/compressão
 * leve/anotar), que não têm PasswordException nativo: com `ignoreEncryption`
 * o load passa, mas copyPages/save de PDF REALMENTE cifrado (user OU owner
 * password, AES) quebra com erro críptico ("Expected instance of PDFDict…")
 * ou gera saída corrompida — melhor falhar cedo com o mesmo shape do erro do
 * pdf.js, que os catches das telas já reconhecem via isPasswordError.
 */
export const passwordProtectedError = (): Error => {
  const e = new Error("PDF protegido por senha");
  e.name = "PasswordException";
  (e as Error & { code: number }).code = NEED_PASSWORD;
  return e;
};
