/// <reference types="vitest/config" />
import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { rolldown } from "rolldown";
import pkg from "./package.json" with { type: "json" };

/**
 * O worker do pdf.js roda numa thread separada (global scope próprio) — os
 * polyfills core-js importados em src/main.tsx não chegam lá. `pdf.worker.min.mjs`
 * usa Uint8Array.prototype.toHex, Promise.try/withResolvers e o global Iterator
 * sem guard, quebrando em WebView <140/128/122 (confirmado: sem isso, "Abrir
 * PDF" trava pra sempre em WebView 124 com "Setting up fake worker").
 *
 * Por que não usar o `?worker&url` normal do Vite pra bundlar um entry com os
 * polyfills + o pdf.worker: o formato de saída do worker do Vite descarta os
 * exports do entry que não são consumidos DENTRO do próprio bundle (Rolldown
 * não permite configurar `preserveEntrySignatures` pra worker). O pdf.js
 * precisa que `pdf.worker.min.mjs` continue um ES module de verdade — ele faz
 * `export { WorkerMessageHandler }`, usado no fallback "fake worker"
 * (`(await import(workerSrc)).WorkerMessageHandler`) quando o Worker real
 * falha (comum em emuladores/WebViews lentos). Sem esse export, o fallback
 * quebra silenciosamente e o carregamento do PDF trava pra sempre sem erro
 * visível.
 *
 * Solução: bundlar os polyfills à parte (IIFE, sem exports) e CONCATENAR na
 * frente do `pdf.worker.min.mjs` original — sem tocar no arquivo em si, que
 * segue intacto (com seu export) depois do banner de polyfills.
 */
function pdfWorkerPolyfillPlugin(): Plugin {
  let banner = "";
  return {
    name: "pdf-worker-polyfill",
    async buildStart() {
      const bundle = await rolldown({
        input: path.resolve(import.meta.dirname, "src/lib/pdfWorkerPolyfills.ts"),
      });
      try {
        const { output } = await bundle.generate({ format: "iife" });
        banner = output[0].code;
      } finally {
        await bundle.close();
      }
    },
    generateBundle(_options, bundle) {
      for (const fileName of Object.keys(bundle)) {
        if (!fileName.includes("pdf.worker.min") || !fileName.endsWith(".mjs")) continue;
        const asset = bundle[fileName];
        if (asset.type !== "asset") continue;
        // `asset.source` normalmente vem como Uint8Array (asset binário/mjs
        // copiado via `?url`); string só no caso do Rolldown decidir emitir
        // como texto — cobrimos os dois.
        if (typeof asset.source === "string") {
          asset.source = `${banner}\n${asset.source}`;
        } else {
          const buf = Buffer.from(asset.source as Uint8Array);
          asset.source = Buffer.concat([Buffer.from(`${banner}\n`), buf]);
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), pdfWorkerPolyfillPlugin()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: { target: "chrome110" },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
