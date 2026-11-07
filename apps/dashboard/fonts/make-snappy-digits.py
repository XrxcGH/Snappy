"""
Builds the four "Snappy Digits" font files in this folder.

Why: Atkinson Hyperlegible Next draws a slashed zero in its only zero glyph and has no OpenType feature that
switches it off (its GSUB table offers ccmp, frac, locl, pnum and tnum). Bricolage Grotesque draws a plain zero.
So the dashboard embeds a digits-only family, "Snappy Digits", cut from Bricolage Grotesque, and lists it FIRST
in the body and display font stacks (brand/tokens/tokens.css). Only the ten characters 0 to 9 come from it; every
letter falls through to Atkinson (or Bricolage in headings). Usernames and code stay in JetBrains Mono.

What it does: subsets the @fontsource/bricolage-grotesque latin files for weights 400, 500, 600 and 700 to
U+0030-0039 with fontTools' pyftsubset, keeps the tnum and pnum features so tabular alignment still works,
and writes woff2 files. The font is subset, not edited, and it keeps its copyright and license notice
(SIL Open Font License 1.1; see THIRD-PARTY-NOTICES.md).

Run from the repository root (fontTools and brotli are needed: pip install fonttools brotli):

    python -I apps/dashboard/fonts/make-snappy-digits.py
"""
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / "node_modules" / "@fontsource" / "bricolage-grotesque" / "files"
OUT = Path(__file__).resolve().parent

for weight in (400, 500, 600, 700):
    options = subset.Options()
    options.flavor = "woff2"
    options.layout_features = ["tnum", "pnum"]
    options.name_IDs = ["*"]  # keep the copyright and license text
    options.notdef_outline = True
    options.hinting = False
    options.glyph_names = False
    font = TTFont(SOURCE / f"bricolage-grotesque-latin-{weight}-normal.woff2")
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=list(range(0x30, 0x3A)))
    subsetter.subset(font)
    target = OUT / f"snappy-digits-{weight}.woff2"
    subset.save_font(font, str(target), options)
    print(target.name, target.stat().st_size, "bytes")
