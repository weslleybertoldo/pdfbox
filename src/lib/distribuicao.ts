/**
 * Canal de distribuição do build.
 *
 * - "site": APK publicado nas GitHub Releases — se atualiza sozinho (UpdateChecker / FooterVersion).
 * - "play": versão da Google Play — a loja proíbe app que baixa e instala APK por conta própria,
 *   então o atualizador in-app fica escondido e a permissão REQUEST_INSTALL_PACKAGES sai do
 *   manifest (build type `playRelease`, ver android/app/src/playRelease/AndroidManifest.xml).
 *
 * Definido em tempo de build: `VITE_DISTRIBUICAO=play npm run build` (scripts `build:play` / `build:aab`).
 */
export type Distribuicao = "site" | "play";

export function distribuicao(): Distribuicao {
  return import.meta.env.VITE_DISTRIBUICAO === "play" ? "play" : "site";
}

/** true no build da Google Play — esconde o atualizador in-app. */
export function ehPlay(): boolean {
  return distribuicao() === "play";
}
