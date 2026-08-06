/**
 * Handoff do arquivo aberto no Viewer pras telas de função (converter,
 * comprimir, dividir, juntar…) via botão de ações do header — mesma mecânica
 * do openFileStore: module-level, consumido UMA vez. Quem seta navega pra
 * rota da função logo em seguida; a tela consome no mount e valida o tipo
 * (mime não bate com a rota → ignora silenciosamente e cai no picker normal).
 *
 * DECISÃO (v1.3.2) — PDF protegido por senha: o handoff entrega os BYTES
 * ORIGINAIS (cifrados) e NÃO carrega a senha digitada no viewer. Repassar a
 * senha só ajudaria as ações via pdf.js (PDF→imagem/Word, compressão
 * média/forte); os caminhos pdf-lib (juntar, dividir/remover, compressão
 * leve, salvar anotação) NÃO decifram nem com a senha (validado
 * empiricamente: copyPages/save quebram com PDF cifrado, mesmo owner-only) —
 * e o histórico/recents nunca teria a senha. Metade das ações funcionando
 * seria pior UX que a regra única atual: qualquer ação sobre PDF protegido
 * mostra PASSWORD_PROTECTED_MSG (pdfErrors.ts).
 */
export interface ActionFile {
  blob: Blob;
  name: string;
  mimeType: string;
}

let pending: ActionFile | null = null;

export const setActionFile = (f: ActionFile): void => {
  pending = f;
};

/** Devolve o arquivo pendente (ou null) e limpa — não re-entrega. */
export const consumeActionFile = (): ActionFile | null => {
  const f = pending;
  pending = null;
  return f;
};

/** Converte pro File que as telas já esperam (picker/histórico entregam File). */
export const actionFileToFile = (f: ActionFile): File =>
  new File([f.blob], f.name, { type: f.mimeType });
