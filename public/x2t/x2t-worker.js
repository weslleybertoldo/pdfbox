/*
 * PDFBox — worker do conversor de Word antigo (.doc → .docx), offline.
 * Roda o x2t do ONLYOFFICE compilado pra WebAssembly (build da CryptPad,
 * https://github.com/cryptpad/onlyoffice-x2t-wasm, AGPL-3.0) — os arquivos
 * x2t.js/x2t.wasm são baixados no build (scripts/fetch-x2t.mjs).
 * Worker clássico (o x2t.js é script clássico e precisa de importScripts).
 *
 * Mensagem de entrada: { id, bytes: ArrayBuffer }
 * Saída: { id, ok: true, bytes: ArrayBuffer } | { id, ok: false, erro }
 */
"use strict";

var pronto = false;
var erroInicio = null;
var fila = [];

var PARAMS =
  '<?xml version="1.0" encoding="utf-8"?>' +
  '<TaskQueueDataConvert xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ' +
  'xmlns:xsd="http://www.w3.org/2001/XMLSchema">' +
  "<m_sFileFrom>/working/entrada.doc</m_sFileFrom>" +
  "<m_sFileTo>/working/saida.docx</m_sFileTo>" +
  "<m_nFormatTo>65</m_nFormatTo>" + // 65 = DOCX
  "<m_bIsNoBase64>false</m_bIsNoBase64>" +
  "</TaskQueueDataConvert>";

self.Module = {
  locateFile: function (arquivo) {
    return new URL(arquivo, self.location.href).href;
  },
  onRuntimeInitialized: function () {
    pronto = true;
    esvaziar();
  },
  onAbort: function (motivo) {
    erroInicio = "o conversor parou: " + motivo;
    esvaziar();
  },
  print: function () {},
  printErr: function () {},
};

try {
  importScripts("x2t.js");
} catch (e) {
  erroInicio = "não carregou o conversor: " + (e && e.message ? e.message : e);
}

self.onmessage = function (e) {
  fila.push(e.data);
  esvaziar();
};

function esvaziar() {
  while (fila.length && (pronto || erroInicio)) {
    var pedido = fila.shift();
    if (erroInicio) {
      self.postMessage({ id: pedido.id, ok: false, erro: erroInicio });
    } else {
      converter(pedido);
    }
  }
}

function apagar(FS, caminho) {
  try {
    FS.unlink(caminho);
  } catch {
    /* não existia */
  }
}

function converter(pedido) {
  var M = self.Module;
  var FS = M.FS;
  try {
    ["/working", "/working/media", "/working/fonts", "/working/themes"].forEach(function (d) {
      try {
        FS.mkdir(d);
      } catch {
        /* já existe */
      }
    });
    apagar(FS, "/working/saida.docx");
    FS.writeFile("/working/entrada.doc", new Uint8Array(pedido.bytes));
    FS.writeFile("/working/params.xml", PARAMS);
    var rc = M.ccall("main1", "number", ["string"], ["/working/params.xml"]);
    var saida = null;
    try {
      saida = FS.readFile("/working/saida.docx");
    } catch {
      saida = null;
    }
    apagar(FS, "/working/entrada.doc");
    apagar(FS, "/working/saida.docx");
    if (rc !== 0 || !saida || !saida.length) {
      self.postMessage({ id: pedido.id, ok: false, erro: "o conversor recusou o arquivo (código " + rc + ")" });
      return;
    }
    var copia = saida.slice().buffer;
    self.postMessage({ id: pedido.id, ok: true, bytes: copia }, [copia]);
  } catch (e) {
    self.postMessage({ id: pedido.id, ok: false, erro: String(e && e.message ? e.message : e) });
  }
}
