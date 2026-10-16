"""Inspect real APK/PE resources for the approved identity. Requires Pillow."""
from pathlib import Path
from io import BytesIO
import hashlib
import json
import struct
import zipfile
from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'artifacts/branding-final/exports'
OUT.mkdir(parents=True, exist_ok=True)

def image_equal(actual, expected):
    actual, expected = actual.convert('RGBA'), expected.convert('RGBA')
    assert actual.size == expected.size, (actual.size, expected.size)
    # Ignore undefined RGB behind fully transparent pixels, compare all visible
    # color and alpha by compositing against both black and white.
    for color in ['black', 'white']:
        def flatten(im):
            base = Image.new('RGBA', im.size, color)
            return Image.alpha_composite(base, im).convert('RGB')
        difference = ImageChops.difference(flatten(actual), flatten(expected))
        assert max(channel.getextrema()[1] for channel in difference.split()) <= 1, 'Packaged icon differs from approved source beyond one-level color rounding'

report = {'identity': 'A1 — Old City Drive', 'apks': [], 'windows': []}
sources = {'icon': 'launcher', 'icon_foreground': 'adaptive-foreground',
           'icon_background': 'adaptive-background', 'icon_monochrome': 'adaptive-monochrome'}
for name in ['DriveAtBaku-native-debug.apk', 'DriveAtBaku-native-opengl.apk', 'DriveAtBaku-interface-qa.apk']:
    path = ROOT / 'android/build' / name
    resource_count = 0
    with zipfile.ZipFile(path) as archive:
        for density in ['mdpi-v4', 'hdpi-v4', 'xhdpi-v4', 'xxhdpi-v4', 'xxxhdpi-v4', None]:
            folder = f'res/mipmap-{density}' if density else 'res/mipmap'
            for icon, source in sources.items():
                image = Image.open(BytesIO(archive.read(f'{folder}/{icon}.webp'))).convert('RGBA')
                assert image.getbbox(), (name, density, icon, 'blank icon')
                if density == 'xxxhdpi-v4':
                    image_equal(image, Image.open(ROOT / f'android/game/branding/{source}.png'))
                    image.save(OUT / f'{name}-{icon}.png')
                if icon == 'icon_monochrome':
                    # Lower-density Godot resampling may round antialiased RGB
                    # below white. The themed mask must still be achromatic.
                    pixels = image.load()
                    assert all(r == g == b for y in range(image.height) for x in range(image.width)
                               for r, g, b, a in [pixels[x, y]] if a > 16)
                    assert image.getpixel((0, 0))[3] == 0
                resource_count += 1
        assert 'res/mipmap-anydpi-v26/icon.xml' in archive.namelist()
    report['apks'].append({'file': name, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                            'icon_resources_checked': resource_count, 'largest_matches_sources': True})

def pe_resources(path):
    data = path.read_bytes()
    pe = struct.unpack_from('<I', data, 0x3c)[0]
    assert data[pe:pe + 4] == b'PE\0\0'
    section_count, optional_size = struct.unpack_from('<H', data, pe + 6)[0], struct.unpack_from('<H', data, pe + 20)[0]
    optional = pe + 24
    directory = optional + (112 if struct.unpack_from('<H', data, optional)[0] == 0x20b else 96)
    resource_rva = struct.unpack_from('<I', data, directory + 16)[0]
    sections = []
    for i in range(section_count):
        size, rva, raw_size, offset = struct.unpack_from('<IIII', data, optional + optional_size + i * 40 + 8)
        sections.append((rva, max(size, raw_size), offset))
    def file_offset(rva):
        return next(offset + rva - base for base, size, offset in sections if base <= rva < base + size)
    base = file_offset(resource_rva)
    result = {}
    def walk(relative, keys):
        count = sum(struct.unpack_from('<HH', data, base + relative + 12))
        for i in range(count):
            key, target = struct.unpack_from('<II', data, base + relative + 16 + i * 8)
            if target & 0x80000000:
                walk(target & 0x7fffffff, keys + (key,))
            else:
                rva, size = struct.unpack_from('<II', data, base + target)
                offset = file_offset(rva)
                result[keys + (key,)] = data[offset:offset + size]
    walk(0, ())
    return result

expected = Image.open(ROOT / 'android/game/branding/app.ico')
expected_sizes = expected.ico.sizes()
executables = [ROOT / 'android/build/DriveAtBaku-native.exe']
wrapper = ROOT / 'android/build/DriveAtBaku-native.console.exe'
if wrapper.exists():
    executables.append(wrapper)
for path in executables:
    assert path.exists(), path
    resources = pe_resources(path)
    groups = [value for key, value in resources.items() if key[0] == 14]
    assert groups, 'Executable contains no icon groups'
    sizes = set()
    for group in groups:
        count = struct.unpack_from('<H', group, 4)[0]
        for i in range(count):
            entry = group[6 + i * 14:20 + i * 14]
            width, height = entry[0] or 256, entry[1] or 256
            resource_id = struct.unpack_from('<H', entry, 12)[0]
            payload = next(value for key, value in resources.items() if key[0] == 3 and key[1] == resource_id)
            ico = struct.pack('<HHH', 0, 1, 1) + entry[:8] + struct.pack('<II', len(payload), 22) + payload
            actual = Image.open(BytesIO(ico))
            image_equal(actual, expected.ico.getimage((width, height)))
            sizes.add((width, height))
    assert sizes == expected_sizes, (path.name, sizes, expected_sizes)
    report['windows'].append({'file': path.name, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                               'sizes': sorted([size[0] for size in sizes]), 'all_match_sources': True})

report['passed'] = True
(OUT / 'verification.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps(report, indent=2))
