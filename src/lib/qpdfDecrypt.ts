import type { QpdfRunner } from "./qpdfRunner";

/**
 * Remove a criptografia de um PDF com o qpdf (`--decrypt`): a saída é um PDF
 * NOVO, sem dicionário /Encrypt — abre em qualquer leitor sem senha, com o
 * conteúdo (texto, imagens, formulários) intacto. Senha vazia serve pra PDF
 * protegido só com senha de dono (o qpdf abre com a senha de usuário vazia).
 * Módulo sem dependência do glue/wasm (recebe o runner) — testável em Node.
 */
export type DecryptOutcome =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; reason: "wrong-password" | "error"; detail: string };

export function decryptWithQpdf(
  runner: QpdfRunner,
  bytes: Uint8Array,
  password: string,
): DecryptOutcome {
  const args = ["--decrypt"];
  if (password) args.push(`--password=${password}`);
  args.push("in.pdf", "out.pdf");
  const run = runner.run(args, { "in.pdf": bytes }, ["out.pdf"]);
  const out = run.files["out.pdf"];
  // 3 = sucesso com avisos (PDF levemente fora do padrão, recuperado)
  if ((run.code === 0 || run.code === 3) && out && out.length > 0) {
    return { ok: true, bytes: out };
  }
  const detail = `${run.stderr}${run.stdout}`.trim();
  if (run.code === 2 && (detail === "" || /invalid password/i.test(detail))) {
    // "invalid password" é o único erro esperado num PDF cifrado; sem stderr
    // capturado (runtime sem TTY) o código 2 ainda é a leitura mais provável
    return { ok: false, reason: "wrong-password", detail };
  }
  return { ok: false, reason: "error", detail: detail || `qpdf saiu com código ${run.code}` };
}
