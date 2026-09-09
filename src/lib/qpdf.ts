// Glue Emscripten do qpdf (CommonJS) + o binário .wasm como asset do bundle
// (sem CDN — o app é offline). O Vite emite o .wasm com hash e o `locateFile`
// do módulo aponta pra essa URL, servida pelo mesmo servidor local do
// Capacitor que entrega o restante do app.
import createModule from "@neslinesli93/qpdf-wasm";
import wasmUrl from "@neslinesli93/qpdf-wasm/dist/qpdf.wasm?url";
import { createQpdfRunner, type QpdfFactory, type QpdfRunner } from "./qpdfRunner";

let runner: Promise<QpdfRunner> | null = null;

/** Instância única (o .wasm de 1,3 MB compila uma vez por sessão); carrega
 *  sob demanda — quem nunca remove senha nunca paga o custo. */
export function getQpdf(): Promise<QpdfRunner> {
  runner ??= createQpdfRunner(createModule as unknown as QpdfFactory, wasmUrl).catch((e) => {
    runner = null; // falha de rede/instanciação → próxima chamada tenta de novo
    throw e;
  });
  return runner;
}
