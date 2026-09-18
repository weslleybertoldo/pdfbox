import { Capacitor } from "@capacitor/core";
import { Browser } from "@capacitor/browser";
import { isSafeUrl } from "./pdfLinks";

/**
 * Abre um link externo do PDF fora do app.
 * - Android: http/https → Chrome Custom Tab (@capacitor/browser); mailto/tel →
 *   navegação que o Bridge do Capacitor intercepta e entrega ao intent do
 *   sistema (e-mail/discador) sem sair da tela.
 * - Web: aba nova.
 * Esquema fora da lista segura (javascript:, file:, …) é ignorado.
 */
export async function openExternalLink(url: string): Promise<void> {
  if (!isSafeUrl(url)) return;
  if (Capacitor.isNativePlatform()) {
    if (/^https?:/i.test(url)) {
      try {
        await Browser.open({ url });
        return;
      } catch {
        // plugin indisponível → cai no window.open (Bridge abre no navegador)
      }
    } else {
      window.location.assign(url);
      return;
    }
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
