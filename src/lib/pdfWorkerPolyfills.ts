// Polyfills pro worker do pdf.js (thread separada, global scope próprio —
// os polyfills de src/main.tsx não chegam lá). Este arquivo é bundlado à
// parte (via rolldown, plugin em vite.config.ts) e o resultado é
// CONCATENADO na frente do `pdf.worker.min.mjs` original, sem tocar no
// arquivo em si — ele precisa continuar um ES module de verdade (com
// `export { WorkerMessageHandler }`) pro fallback "fake worker" do próprio
// pdf.js funcionar. Ver o plugin `pdfWorkerPolyfillPlugin` em vite.config.ts
// pro motivo de não dar pra usar o `?worker&url` normal do Vite aqui.
import "core-js/actual/promise/with-resolvers"; // Promise.withResolvers (Chrome ≥119)
import "core-js/actual/promise/try"; // Promise.try (Chrome ≥128)
import "core-js/proposals/array-buffer-base64"; // Uint8Array.prototype.toHex (Chrome ≥140)
import "core-js/actual/iterator"; // global Iterator / Iterator Helpers (Chrome ≥122)
import "core-js/actual/map/get-or-insert-computed"; // Map.prototype.getOrInsertComputed (Chrome ≥140)
import "core-js/actual/weak-map/get-or-insert-computed"; // idem, WeakMap
import "core-js/actual/array-buffer/transfer-to-fixed-length"; // ArrayBuffer#transferToFixedLength (Chrome ≥114); usado só no worker
