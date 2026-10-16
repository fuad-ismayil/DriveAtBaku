"""Generate review-only SVG branding systems; no live asset is modified."""
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
INK, PEARL, MINT = "#0d171b", "#edf5f2", "#9fe4d4"
FONT = TTFont(ROOT / "public/assets/fonts/AlteDIN1451-Regular.ttf")
GLYPHS, CMAP = FONT.getGlyphSet(), FONT.getBestCmap()

def outline(text, height):
    scale = height / FONT['head'].unitsPerEm
    x, pieces = 0, []
    for letter in text:
        glyph = CMAP[ord(letter)]
        pen = SVGPathPen(GLYPHS)
        GLYPHS[glyph].draw(pen)
        pieces.append(f'<path transform="translate({x * scale:.3f} 0) scale({scale:.6f} {-scale:.6f})" d="{pen.getCommands()}"/>')
        x += FONT['hmtx'][glyph][0]
    return ''.join(pieces), x * scale

def mark_a(tiny=False):
    return f'''<defs><mask id="road-cut"><rect width="100" height="100" fill="#fff"/><path fill="#000" d="M43 84 50 53H59L55 84Z"/></mask></defs>
    <path fill="{PEARL}" mask="url(#road-cut)" fill-rule="evenodd" d="M24 20H47C69 20 82 32 82 50S69 80 47 80H24ZM36 32V68H46C61 68 70 62 70 50S61 32 46 32Z"/>
    <path stroke="{MINT}" stroke-width="{'3' if tiny else '2.4'}" stroke-linecap="round" d="{'M49 75 53 58' if tiny else 'M49 76 51 67M53 59 54 54'}"/>'''

def mark_b(tiny=False):
    return f'''<g fill="{PEARL}"><path d="M22 72C30 58 27 40 43 25C37 43 43 56 34 72Z"/>
    <path d="M41 72C49 53 44 32 62 16C54 36 62 53 52 72Z"/>
    <path d="M61 72C69 61 66 47 80 36C74 51 81 61 72 72Z"/></g>
    <path d="M20 82Q48 72 80 80" fill="none" stroke="{MINT}" stroke-width="{'4' if tiny else '3'}" stroke-linecap="round"/>'''

def mark_c(tiny=False):
    return f'''<g fill="{PEARL}"><path d="M21 81 42 22H48L37 81Z"/><path d="M63 81 52 22H58L79 81Z"/></g>
    <g fill="{MINT}"><path d="M49 29H51L52 43H48Z"/><path d="M47 54H53L56 76H44Z"/></g>'''

CONCEPTS = [('a-boulevard', 'Boulevard D', mark_a), ('b-flame-route', 'Flame Route', mark_b), ('c-open-road', 'Open Road', mark_c)]
type_paths, type_width = outline('DriveAtBaku', 39)
subtitle, subtitle_width = outline('AN OPEN ROAD EXPERIENCE', 9)
for slug, name, draw in CONCEPTS:
    def svg(content, view='0 0 100 100', width='100', height='100'):
        return f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="{view}" role="img" aria-label="DriveAtBaku · {name} draft"><title>DriveAtBaku · {name} · unapproved proposal</title>{content}</svg>\n'
    (HERE / f'{slug}-mark.svg').write_text(svg(draw()), encoding='utf-8')
    # Full-bleed square background. Launcher masks belong to the OS, not the art.
    (HERE / f'{slug}-app.svg').write_text(svg(f'<rect width="100" height="100" fill="{INK}"/>{draw()}'), encoding='utf-8')
    mono = draw().replace(PEARL, INK).replace(MINT, INK)
    (HERE / f'{slug}-themed.svg').write_text(svg(f'<rect width="100" height="100" fill="#b9d9cb"/>{mono}'), encoding='utf-8')
    (HERE / f'{slug}-favicon.svg').write_text(svg(f'<rect width="100" height="100" rx="19" fill="{INK}"/><g transform="translate(50 50) scale(1.24) translate(-50 -50)">{draw(True)}</g>'), encoding='utf-8')
    lockup = f'<g transform="translate(0 0) scale(.82)">{draw()}</g><g fill="{PEARL}" transform="translate(93 48)">{type_paths}</g><g fill="{MINT}" transform="translate(95 67)">{subtitle}</g>'
    (HERE / f'{slug}-wordmark.svg').write_text(svg(lockup, '0 0 355 86', '355', '86'), encoding='utf-8')
print('Generated three review-only vector systems: mark, favicon, app icon, themed-icon preview and menu wordmark.')
