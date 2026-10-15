/**
 * Regra do botão voltar do Android (gesto ou botão).
 *
 * Sem listener, o plugin App do Capacitor só faz `webView.goBack()` e, sem
 * histórico, ENGOLE o voltar: o app ficava preso na tela inicial — e, aberto
 * por outro app (Compartilhar / "Abrir com"), preso por cima dele. Regra:
 * - popup "Deseja sair?" aberto → fecha o popup (fica no app);
 * - tela aberta por outro app ou tela inicial → pergunta "Deseja sair?";
 * - qualquer outra tela → volta uma tela (sem histórico: vai pro início).
 */

export type BackAction = "close-dialog" | "ask-exit" | "go-back" | "go-home";

export interface BackState {
  /** o popup "Deseja sair?" está na tela */
  dialogOpen: boolean;
  /** rota atual é a tela inicial ("/") */
  atHome: boolean;
  /** a entrada atual do histórico foi aberta por outro app */
  externalEntry: boolean;
  /** a WebView tem histórico pra voltar (vem do evento nativo) */
  canGoBack: boolean;
}

export function backAction(s: BackState): BackAction {
  if (s.dialogOpen) return "close-dialog";
  if (s.externalEntry || s.atHome) return "ask-exit";
  return s.canGoBack ? "go-back" : "go-home";
}

/** state de rota que marca a tela aberta por outro app (fica no histórico) */
export const EXTERNAL_ENTRY_STATE = { fromOtherApp: true } as const;

export function isExternalEntry(state: unknown): boolean {
  return (state as { fromOtherApp?: unknown } | null)?.fromOtherApp === true;
}
