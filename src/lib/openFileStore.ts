/**
 * Handoff de arquivo pro Viewer quando os bytes vêm de fora do picker —
 * intent ACTION_VIEW (outro app abriu um PDF/imagem "com o PDFBox") ou o
 * botão "Visualizar" do ResultPanel. Module-level e consumido UMA vez:
 * quem seta navega pra /viewer logo em seguida, o Viewer consome no mount.
 */
export interface OpenFile {
  bytes: Uint8Array;
  name: string;
  mimeType: string;
}

let pending: OpenFile | null = null;

export const setOpenFile = (f: OpenFile): void => {
  pending = f;
};

/** Devolve o arquivo pendente (ou null) e limpa — não re-entrega. */
export const consumeOpenFile = (): OpenFile | null => {
  const f = pending;
  pending = null;
  return f;
};
