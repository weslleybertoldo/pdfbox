/**
 * Remove url(...) não embutidas de um trecho de CSS e qualquer @import. Módulo
 * puro (sem pdf.js/html2canvas) pra ser usado também pela sanitização do Word.
 */
export const stripCssUrls = (css: string) =>
  css
    .replace(/@import[^;]*;?/gi, "")
    .replace(/url\(\s*(["']?)(?![\s"']*(?:data:|blob:|#))[^)]*\)/gi, "none");
