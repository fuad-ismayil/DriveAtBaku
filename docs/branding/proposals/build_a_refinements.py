"""Build review-only refinements of the preferred Boulevard D direction."""
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen

HERE = Path(__file__).resolve().parent
INK, PEARL, MINT = '#0d171b', '#edf5f2', '#9fe4d4'
FONT = TTFont(HERE.parents[2] / 'public/assets/fonts/AlteDIN1451-Regular.ttf')
GLYPHS, CMAP = FONT.getGlyphSet(), FONT.getBestCmap()

def outline(text, height):
    scale, x, paths = height / FONT['head'].unitsPerEm, 0, []
    for letter in text:
        glyph = CMAP[ord(letter)]
        pen = SVGPathPen(GLYPHS)
        GLYPHS[glyph].draw(pen)
        paths.append(f'<path transform="translate({x * scale:.3f} 0) scale({scale:.6f} {-scale:.6f})" d="{pen.getCommands()}"/>')
        x += FONT['hmtx'][glyph][0]
    return ''.join(paths)

def draw(kind, tiny=False):
    # Shared D and road opening preserve the selected direction's silhouette.
    body = f'<path fill="{PEARL}" fill-rule="evenodd" d="M24 20H47C69 20 82 32 82 50S69 80 47 80H24ZM36 32V68H46C61 68 70 62 70 50S61 32 46 32Z"/>'
    if kind == 'a1-old-city':
        # An abstract cylindrical tower and offset buttress, inspired by Maiden Tower.
        detail = f'<path fill="{PEARL}" d="M39 69V46Q39 42 44 42H46Q50 42 50 46V51L55 55V69Z"/>'
        windows = '' if tiny else '<path stroke="#000" stroke-width="1.5" d="M44.5 47V49M44.5 53V55M44.5 59V61"/>'
        cut = 'M48 85 55 57H62L59 85Z'
        road = 'M54 76 56 68' if tiny else 'M54 76 56 68M57.5 62 58 59'
    else:
        # D's outer bowl suggests a shoreline; the two arcs are the Caspian water.
        detail = f'<g fill="none" stroke="{MINT}" stroke-width="2.3" stroke-linecap="round"><path d="M40 46Q46 42 52 46T64 46"/>'
        if not tiny:
            detail += '<path d="M40 53Q46 49 52 53T64 53"/>'
        detail += '</g>'
        windows, cut = '', 'M43 84 50 58H59L55 84Z'
        road = 'M49 76 53 62' if tiny else 'M49 76 51 68M52.5 63 53 60'
    return f'<defs><mask id="open-road"><rect width="100" height="100" fill="#fff"/><path fill="#000" d="{cut}"/>{windows}</mask></defs><g mask="url(#open-road)">{body}{detail}</g><path d="{road}" stroke="{MINT}" stroke-width="{3 if tiny else 2.4}" stroke-linecap="round"/>'

for slug, name in [('a1-old-city', 'Old City Drive'), ('a2-caspian', 'Caspian Boulevard')]:
    def svg(content, view='0 0 100 100', width=100, height=100):
        return f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="{view}" role="img" aria-label="DriveAtBaku {name} proposal"><title>{name} · unapproved A refinement</title>{content}</svg>\n'
    for suffix, content in [
        ('mark', draw(slug)),
        ('app', f'<rect width="100" height="100" fill="{INK}"/>{draw(slug)}'),
        ('themed', f'<rect width="100" height="100" fill="#b9d9cb"/>{draw(slug).replace(PEARL, INK).replace(MINT, INK)}'),
        ('favicon', f'<rect width="100" height="100" rx="19" fill="{INK}"/><g transform="translate(50 50) scale(1.24) translate(-50 -50)">{draw(slug, True)}</g>'),
    ]:
        (HERE / f'{slug}-{suffix}.svg').write_text(svg(content), encoding='utf-8')
    wordmark = f'<g transform="scale(.82)">{draw(slug)}</g><g fill="{PEARL}" transform="translate(93 48)">{outline("DriveAtBaku", 39)}</g><g fill="{MINT}" transform="translate(95 67)">{outline("AN OPEN ROAD EXPERIENCE", 9)}</g>'
    (HERE / f'{slug}-wordmark.svg').write_text(svg(wordmark, '0 0 355 86', 355, 86), encoding='utf-8')
print('Generated two unapproved A refinements; production assets untouched.')
