#!/usr/bin/env python3
"""Gera public/fonts/docx/*.woff2: fontes livres com a MESMA métrica das fontes do
Word (Tinos = Times New Roman, Arimo = Arial, Cousine = Courier New,
Carlito = Calibri, Caladea = Cambria, Gelasio = Georgia), recortadas pra latim +
pontuação e símbolos comuns. Sem elas o Android troca a fonte do documento pela
do sistema, o texto quebra em outros pontos e a página do Word muda.

Uso:
  python3 -m venv /tmp/fv && /tmp/fv/bin/pip install fonttools brotli
  /tmp/fv/bin/python scripts/build-docx-fonts.py
"""
import os
import urllib.parse
import urllib.request

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

# commit fixo do github.com/google/fonts (reprodutível)
COMMIT = "b5efa9c32e8f9b63005f5cdb1ad5527a77d2cd04"
RAW = f"https://raw.githubusercontent.com/google/fonts/{COMMIT}/ofl"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "fonts", "docx")
CACHE = "/tmp/pdfbox-fonts-cache"
RANGES = "U+0000-024F,U+02B0-036F,U+1E00-1EFF,U+2000-22FF,U+2500-25FF,U+FB00-FB06"
STATIC = {"Tinos": "tinos", "Cousine": "cousine", "Carlito": "carlito", "Caladea": "caladea"}
VARIABLE = {"Arimo": "arimo", "Gelasio": "gelasio"}  # arquivos [wght] + Italic[wght]
STYLES = ["Regular", "Bold", "Italic", "BoldItalic"]
# A licença do Carlito (OFL) tem "Reserved Font Name": versão modificada (o
# recorte é modificação) não pode usar o nome. Vira "PDFBox Sans C".
RENAME = {"Carlito": ("PDFBox Sans C", "PDFBoxSansC")}


def fetch(path: str) -> str:
    os.makedirs(CACHE, exist_ok=True)
    local = os.path.join(CACHE, f"{COMMIT[:12]}_{path.replace('/', '_')}")
    if not os.path.exists(local):
        urllib.request.urlretrieve(f"{RAW}/{urllib.parse.quote(path)}", local)
    return local


def rename(font: TTFont, fam: str) -> str:
    """Troca o nome da família no name table (e devolve o prefixo do arquivo)."""
    if fam not in RENAME:
        return fam
    new, ps = RENAME[fam]
    for rec in font["name"].names:
        text = rec.toUnicode()
        if fam in text:
            rec.string = text.replace(f"{fam}-", f"{ps}-").replace(fam, new)
    return ps


def write(font: TTFont, name: str) -> None:
    opts = subset.Options()
    opts.flavor = "woff2"
    opts.layout_features = ["*"]
    opts.name_IDs = ["*"]
    opts.hinting = False  # a WebView do Android não usa o hinting TrueType; arquivo menor
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=subset.parse_unicodes(RANGES))
    sub.subset(font)
    font.flavor = "woff2"
    font.save(os.path.join(OUT, f"{name}.woff2"))


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    for fam, folder in STATIC.items():
        for style in STYLES:
            font = TTFont(fetch(f"{folder}/{fam}-{style}.ttf"))
            write(font, f"{rename(font, fam)}-{style}")
    for fam, folder in VARIABLE.items():
        for italic in (False, True):
            src = fetch(f"{folder}/{fam}{'-Italic' if italic else ''}[wght].ttf")
            for weight, style in ((400, "Regular"), (700, "Bold")):
                font = instancer.instantiateVariableFont(TTFont(src), {"wght": weight})
                name = (("Bold" if weight == 700 else "") + "Italic") if italic else style
                write(font, f"{fam}-{name}")
    files = [f for f in os.listdir(OUT) if f.endswith(".woff2")]
    total = sum(os.path.getsize(os.path.join(OUT, f)) for f in files)
    print(f"ok: {len(files)} arquivos, {total} bytes")


if __name__ == "__main__":
    main()
