import { Capacitor } from "@capacitor/core";
import { Browser } from "@capacitor/browser";

/**
 * Abre a URL de download do APK.
 * No Android (Capacitor) usa o Browser/Custom Tab — o WebView do app não tem
 * download manager, então um <a href>/window.open não baixa o .apk. O Custom Tab
 * é o Chrome real: baixa o arquivo do GitHub Release e o Android oferece instalar.
 * Na web mantém o comportamento de abrir em nova aba.
 */
export async function openApkDownload(url: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await Browser.open({ url });
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}
