/**
 * Handoff do arquivo aberto no Viewer pras telas de função (converter,
 * comprimir, dividir, juntar…) via botão de ações do header — mesma mecânica
 * do openFileStore: module-level, consumido UMA vez. Quem seta navega pra
 * rota da função logo em seguida; a tela consome no mount e valida o tipo
 * (mime não bate com a rota → ignora silenciosamente e cai no picker normal).
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
