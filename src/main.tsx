// Polyfills para WebView Android antigas (stock 113/124 sem Chrome ≥119/128/140).
// Devem vir ANTES de qualquer outro import — pdfjs-dist 6.2 e o bundle principal
// usam essas APIs sem fallback (evidência: QA android-34/35 stock = tela branca
// ou "n.toHex is not a function").
import 'core-js/actual/promise/with-resolvers' // Promise.withResolvers (Chrome ≥119)
import 'core-js/actual/promise/try' // Promise.try (Chrome ≥128)
import 'core-js/proposals/array-buffer-base64' // Uint8Array.prototype.toHex/fromHex/... (Chrome ≥140)
// Global `Iterator` (Iterator Helpers, Chrome ≥122). SEM ISSO o app fica com
// tela branca em WebView 113: pdfjs-dist 6.2 tem `if (typeof
// Iterator.prototype.join !== "function") Iterator.prototype.join = ...` no
// topo do módulo, sem checar se `Iterator` existe — em Chrome <122 isso
// lança ReferenceError na avaliação do bundle, antes do React montar
// (confirmado rodando o build em Chromium 112 via Playwright).
import 'core-js/actual/iterator'
// Map/WeakMap.prototype.getOrInsertComputed (proposal "Upsert", Chrome ≥140).
// pdfjs-dist 6.2 chama `map.getOrInsertComputed(key, fn)` sem guard em várias
// partes (cache de fontes, optional content, requisições por chunk); sem o
// polyfill quebra com "getOrInsertComputed is not a function" ao renderizar
// qualquer PDF (confirmado via Chromium 112 no build real).
import 'core-js/actual/map/get-or-insert-computed'
import 'core-js/actual/weak-map/get-or-insert-computed'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
