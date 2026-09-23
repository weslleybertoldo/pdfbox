import { isSafeUrl } from "../pdfLinks";
import { stripCssUrls } from "../convert/cssUrls";

/** href permitido no documento: http(s)/mailto/tel (isSafeUrl) ou âncora interna "#x". */
export const isAllowedHref = (href: string): boolean => {
  const h = href.trim();
  return /^#\S*$/.test(h) || isSafeUrl(h);
};

const DROP = "script,iframe,frame,object,embed,link,meta,base,form,input,button,textarea,select";
const MEDIA_ATTRS = new Set(["src", "poster", "background", "data"]);

/**
 * Varredura de segurança do DOM que a docx-preview gerou: o .docx é entrada não
 * confiável e a WebView do Capacitor tem a ponte nativa na origem do app.
 * Remove elementos ativos, handlers on*, href fora da lista, mídia que não seja
 * data:/blob: e url() externa em estilo (nenhuma requisição de rede).
 */
export function sanitizeDocxDom(root: ParentNode): void {
  root.querySelectorAll(DROP).forEach((el) => el.remove());
  for (const el of Array.from(root.querySelectorAll("*"))) {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on") || name === "srcset" || name === "imagesrcset") {
        el.removeAttribute(attr.name);
      } else if (name === "href" || name === "xlink:href") {
        if (!isAllowedHref(attr.value)) el.removeAttribute(attr.name);
      } else if (MEDIA_ATTRS.has(name)) {
        if (!/^\s*(data:|blob:)/i.test(attr.value)) el.removeAttribute(attr.name);
      } else if (name === "style") {
        const clean = stripCssUrls(attr.value);
        if (clean !== attr.value) el.setAttribute("style", clean);
      }
    }
    if (el.tagName === "STYLE" && el.textContent) el.textContent = stripCssUrls(el.textContent);
  }
}
