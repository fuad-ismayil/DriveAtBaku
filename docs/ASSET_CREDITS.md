# Asset credits

- **Baku City Circuit:** supplied by the user under `levels/baku`. The level metadata credits a port of an Assetto Corsa track. Further original authorship and redistribution terms were not included with the source.
- **Government House enhancements:** runtime limestone relief/glass masks derive from the existing map textures; the window surrounds, flagpole and Azerbaijani flag artwork are generated in code. The supplied night photograph and linked references in [Government House](GOVERNMENT_HOUSE.md) guide appearance and are not bundled as assets. Existing map terms continue to apply to the underlying geometry and photographic textures.
- **Room-light masks:** `public/assets/environment/room-windows.png` is generated from the existing map's glass regions using the audited profiles in `scripts/windowAtlasProfiles.json`. Light surfaces and room activity are generated in code; see [room lighting](ROOM_LIGHTS.md). No external photographs are bundled, and the underlying map artwork retains its existing terms.
- **Ferrari 458 Italia car model:** [vicent091036 on Sketchfab](https://sketchfab.com/models/57bf6cc56931426e87494f554df1dab6), licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), distributed in the [three.js example assets](https://github.com/mrdoob/three.js/blob/dev/examples/models/gltf/ferrari.glb). This project recolors its body, glass, and wheels and animates its separate wheel groups.
- **Elantra/Avante sedan:** extracted from the user-supplied `elantra.html` showroom export. That showroom credits Sergey Shamarin / alix999 and links to a [Hyundai Elantra 2015 HQ community model](https://www.gtainside.com/sanandreas/cars/124063-hyundai-elantra-2015-hq). The original body, interior, lights, and textures are reused here. The showroom describes it as an early fifth-generation Elantra used as a visual stand-in for a 2012 sedan. Its original model rights remain with their respective owners; redistribution terms were not supplied.
- **Elantra wheel:** supplied separately as `elantra left front wheel.glb`, copied unchanged to `public/assets/vehicles/elantra-wheel.glb`. Its complete tire and rim are fitted to all four corners with shared geometry and adjusted material finishes. Authorship/redistribution terms were not included with this file.
- **Mercedes-AMG body and wheels:** user-supplied `AMG.glb` and `AMG_WHEEL.glb` from a local asset collection, copied unchanged to `public/assets/vehicles/amg.glb` and `amg-wheel.glb`. Runtime fitting normalizes body/wheel scale, selects one of the four overlapping wheel assemblies, shares it across the four corners, and adjusts material finishes. Authorship, exact model variant/year and redistribution terms were not supplied.
- **Toyota Prado body and wheels:** user-supplied `PRADO.glb` and `PRADO_WHEEL.glb` from the same asset folder, copied unchanged to `public/assets/vehicles/prado.glb` and `prado-wheel.glb`. Runtime fitting preserves the body/interior/spare wheel and uses the supplied rolling wheel at all four corners with stationary calipers. Authorship, exact model variant/year and redistribution terms were not supplied.
- **Draco decoder:** Google Draco, distributed with the three.js example assets under [Apache 2.0](../public/draco/LICENSE). Included locally so vehicles load without an external decoder service. Three.js itself uses the MIT license; that license does not replace Draco's terms.
- **Plate typography:** [Alte DIN 1451](https://www.peter-wiegel.de/alteDin1451.html), copyright 2017 Peter Wiegel, reserved font name "Alte DIN 1451", distributed under the [SIL Open Font License 1.1](../public/assets/fonts/AZ-DIN-OFL.txt). The original regular cut supplies the numbers; the pressed/bold cut supplies the letters. Both files (`din1451alt.ttf` and `din1451alt_g.ttf`) are bundled unchanged as `AlteDIN1451-Regular.ttf` and `AlteDIN1451-Pressed.ttf` for the garage font and the vector contours for the embossed lettering. Its designer provides the slightly heavier cut to resemble pressed lettering. Derived mesh contours in `plateGlyphs.js` retain the attribution and counter orientation. The supplied reference illustration guides the font choice; the watermarked JPG is not included as a game asset. Plate geometry and identity artwork use the dimensional references in [AZSTAND's published AZS 599 drawings](https://azstand.gov.az/upload/files/AZS%20599-2015%20%20Son%20%20deyisiklik.pdf).
- **Engine audio:** CC0 racing-car recordings by domasx2 and CC BY-SA 4.0 V8 load/overrun recordings by DerMeehdrescher / Meehdrescher Studios. See the [per-file source and license details](../public/assets/audio/engines/SOURCES.md).
- **Interface artwork:** web Liquid Glass is implemented in CSS with SVG paths in `index.html`; the native Android adaptation uses `android/game/shaders/liquid_glass.gdshader` and code-authored paths in `ui_icons.gd`, including pedal and automotive horn pictograms. User-supplied glass-button references guide appearance and are not bundled as image assets. General interface text uses local system fonts; no UI font download is required. The separately licensed plate fonts above remain bundled for registrations.
- **Horn audio:** the web horn is synthesized from two filtered sawtooth voices. `android/tools/prepare_horn.mjs` bakes the same frequencies/filter settings into a local PCM loop; no external horn recording is added.
- **Loading scenes:** `city.webp`, `night.webp`, `weather.webp` and `garage.webp` under `public/assets/loading/` were captured on 15 October 2026 from this game's current renderer at native 3840 × 2160, using the Cinematic preset. They show the Ferrari by day/night, the AMG on wet streets and the Prado. The [capture metadata](../public/assets/loading/captures.json) records camera positions, vehicles, conditions and drawing-buffer dimensions; [the interface guide](LOADING_EXPERIENCE.md) explains regeneration. Android preparation resizes city/night to 1920 pixels wide for its packaged loading slideshow. These are game captures, with no external photography or AI-generated replacement scenery; underlying model/map terms still apply.

## Branding proposals awaiting approval

The original code-authored **A1 — Old City Drive** identity was selected by the
user. Its D/road/Maiden Tower-inspired mark, menu wordmark, favicon and app icon
masters live under `public/branding/`; derived native assets live under
`android/game/branding/` and `android/game/icon.png`. Rejected proposals under
`docs/branding/proposals/` are retained only as review history. No third-party
logo or stock artwork is incorporated. Wordmark lettering is outlined from the
existing OFL Alte DIN 1451 font listed above. Review backgrounds reuse existing
game captures. See the [branding documentation](branding/README.md) for meaning,
regeneration and platform variants.

## Indicator fitment research

The exported geometry takes precedence over generic vehicle names. Exact build years, destination markets and trim equipment cannot be authenticated from these assets: they contain no VIN or reliable variant metadata. The following identities are visual inferences, with catalog/source labels kept separate. Amber signals follow the fitted clear/amber regions, including mirror equipment actually present; US red rear-signal alternatives are not imposed on this Baku fitment.

| Asset | Identity evidence and uncertainty | Fitted signal surfaces |
| --- | --- | --- |
| Elantra | MD four-door sedan; projector headlamps, L-shaped fog recesses and mirror strips resemble the 2014–2015 facelift. Source attribution says 2015 HQ, while the game catalog says 2012; exact trim/year remains unconfirmed. | Upper outer front pockets, lower outer rear clear turn-signal pockets, both authored `mirror_si0` lenses. Projectors, fogs and reverse pockets remain independent. |
| Prado | J150 five-door SUV with the early 2009–2013 front/rear lamp shape; exact year/trim unconfirmed. | Authored front amber bulbs/pockets, upper clear rear turn bands above the white reverse bands, mirror lenses and their three bulbs. |
| AMG | C190 AMG GT-family two-door coupe with Panamericana-style grille and fixed wing; no evidence establishes GT/GT S/GT R trim or model year, and its mixed/custom styling prevents a precise claim. | Outer headlamp light-guide chamber, clear middle rear LED band between red strips, both existing mirror strips in the shared glass mesh. Lower bumper lamps and windows excluded. |
| Ferrari | Catalog/creator label: 458 Italia, catalog year 2010. The supplied visual has an open roof, so the precise Italia/Spider body configuration and model year cannot be authenticated. Both 458 manuals confirm front/rear LED signals and incandescent side repeaters. | Authored front diode arrays, centre discs within the rear circular tail/stop rings, small fender repeaters behind the front wheel arches. No mirror indicators added. |

References: [Hyundai's 2015 facelift announcement](https://hyundai.simemotors.my/news-room/press-release/2015-03-05-News.aspx), [Hyundai's 2015 Elantra specifications/lighting announcement](https://www.prnewswire.com/news-releases/2015-elantra-brings-feature-packed-value-to-shoppers-265697881.html), [Hyundai's 2012 brochure, including trim-dependent mirror signals](https://xr793.com/wp-content/uploads/2017/02/2012-Hyundai-Elantra.pdf), [Toyota's J150 launch photographs/specifications](https://media.toyota.co.uk/toyota-launches-the-all-new-land-cruiser/), [Toyota's 2009–2011 J150 owner manual](https://toyotamanuals.com.au/docs/landcruiser-prado-150-series-owners-manual-aug-09-oct-11/), [Mercedes C190 owner manual](https://static.oneweb.mercedes-benz.com/css-oom-assets/en-kw/pdf/mercedes-amg-gt-coupe-2018-april-c190-comand-owners-manual-1.pdf), [Ferrari's 458 Italia manual, bulb table on page 185](https://www.manualslib.com/manual/900232/Ferrari-458-Italia.html), [Ferrari's 458 Spider manual via Ferrari of Fort Lauderdale](https://di-uploads-pod31.s3.us-east-1.amazonaws.com/ferrarioffortlauderdale/uploads/2020/05/458spider.pdf).

All signal surfaces reuse the supplied geometry and preserve material properties while off. Shader masks compose with existing headlight/reverse/water shaders. Active amber emission retains surface texture and viewing-angle variation, uses existing bloom/reflection rendering, and adds no meshes, point lights, shadow maps or per-blink network messages. This is a researched fit to the supplied artwork, not certification of an exact regional production vehicle.

The gameplay preview and loading images are captures rendered with these game
assets; they do not establish additional redistribution rights. Tire audio is
credited alongside the engine recordings in the linked source list.

## Native preview dependencies

The Android preview uses Godot 4.6.1 and its matching export templates; the
Godot C++ bindings are downloaded at the revision pinned in `android/build.ps1`,
rather than vendored as generated build output. Deterministic elementary math
comes from V8 13.6.233 / Sun fdlibm: the source notices and BSD license are
retained under [android/native/third_party/fdlibm](../android/native/third_party/fdlibm/README.md).
The generated in-app credits also retain the math, font and audio notices.
Packaging existing vehicle and city assets for Android does not establish new
redistribution rights for those assets.

There is no project-wide source-code license. Map and supplied-vehicle terms
remain unresolved; individual Ferrari, audio, font and decoder licenses do not
cover those files. This fan-made project is not affiliated with Forza, Ferrari,
Hyundai, Mercedes-Benz, Toyota, Formula 1, or the circuit's rights holders.
