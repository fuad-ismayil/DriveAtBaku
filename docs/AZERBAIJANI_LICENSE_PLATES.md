# Azerbaijani garage license plates

Implemented and verified locally on October 2, 2026.

## Player controls

The garage's License Plate section begins with Enable License Plate ON/OFF. OFF hides both complete plate assemblies, including their removable frames, brackets, screws and rear registration lights, and hides the remaining controls. The model's natural bumper and recess geometry stays intact. ON restores the fitted assemblies.

Separate fields accept a two-digit region, two uppercase Latin letters and a three-digit serial. Unsupported letters/symbols are filtered, numeric groups are padded on blur, and empty/invalid groups restore valid values. There is no unrestricted registration text or country selector. Each car saves its own enabled state, groups, hyphens, format and identity treatment. Corrupt or unavailable storage falls back to valid defaults.

The standard older-style example is `10-AA-001`. Selecting Older restores hyphens and the RFID panel; its long layout also permits a manual hyphen toggle. Selecting New omits both, displaying `10 AA 001`, and disables the hyphen toggle. Compact plates use the authentic layout without hyphens: region above the two letters and three serial digits. View Front, View Rear and Whole Car let the player inspect the physical result. Previously saved RFID/plain identity selections migrate to Older/New without losing the number groups.

## Manufactured plate geometry

Dimensional/layout references are [AZSTAND's published AZS 599 drawings](https://azstand.gov.az/upload/files/AZS%20599-2015%20%20Son%20%20deyisiklik.pdf), especially Type I and Type III. The separate manufactured plates measure 520 × 110 mm and 300 × 150 mm, with 13 mm corner radii. They are never scaled to fit the car. The publicly listed [2025 standard](https://e-standart.gov.az/Standard/Details/1fe7e777-039e-4230-a619-1f4b11899024) supersedes the older document; the available drawings provide the visual reference for these established civilian layouts, rather than a claim of regulatory certification.

The aluminum sheet has subtle thickness and rolled/beveled edges. Real extruded DIN 1451 sans-serif contours rise 1.5 mm from the face; black enamel tops have shallow beveled metal/enamel shoulders. The raised border reaches 1.6 mm and joins the sheet. Alte DIN 1451 matches the user's supplied industrial block lettering reference more closely than the earlier narrow OSP digitization. Following visual feedback, numbers use the original regular cut to reduce their stroke weight, while letters keep the pressed cut. The garage preview uses the same weights. Glyph proportions are retained within the manufactured character cells, with a naturally narrower "1". Per-glyph contour orientation preserves white counters, including the printed A in AZ. The unmodified fonts, derived mesh contours and license are attributed in the asset credits.

Both identity styles use a straight rectangular Azerbaijani flag with the crescent/eight-pointed star. Older has a framed AZ/RFID window below the flag on long plates; its compact RFID window sits at the upper right, with AZ below the flag on the left. New has a bare AZ marking and no RFID rectangle or hyphens. There is no waving flag variant, foreign plate, invented QR code or fictional identity design.

Reflective white sheeting uses restrained physical material roughness/clearcoat and microscopic deterministic surface grain. A bounded retroreflective lobe adds brightness only from direct illumination aligned with the viewer; it uses the post-shadow light color and adds no emission. Characters, aluminum sides and holders use separate finishes. Two small rear registration lamps follow low/high driving lights and remain off with lights off.

## Individual mounting

`src/licensePlateFitments.js` contains separate measured front/rear profiles for each car and each format, in the final fitted car coordinates. Profiles identify the actual bumper meshes, center, pitch, carrier dimensions and mounting anchors. Runtime ray measurements place the face outside curved surfaces and extend two steel supports to the measured bumper contacts. Format changes rebuild both plate geometry and carrier/position; number changes remain attached even on a translated or rotated car.

| Car | Front | Rear | Source cleanup |
| --- | --- | --- | --- |
| Ferrari 458 | Upper edge of the central grille, with a bridge supported by the painted bumper | Bumper recess above the triple exhaust, with its own slope | No supplied registration artwork |
| Elantra / Avante | Separate front bumper mesh, above the lower grille | Raised into the boot-lid recess, with the compact format lifted more than the long format | Natural body geometry retained |
| Mercedes-AMG | Lower grille/bumper bridge, measuring both paint and black trim | Rear number recess with independent flat carrier | Illinois artwork hidden; only the measured old holder's triangles removed from a shared interior-plastic mesh |
| Toyota Prado | Front bumper pedestal, measuring the separate front paint/plastic parts | Tailgate number recess beneath the trim | Separate front/rear branded plate faces hidden |

These assemblies move with each car's chassis. Collision dimensions, wheel fitting, suspension, dynamics and saved paint are unchanged. Added plates can extend a few millimeters beyond a bumper; original-body normalization checks now measure the original visual rig and separately constrain mounted bounds.

Follow-up fit adjustments raise the Elantra rear long/compact profile centers by 60/70 mm and the Ferrari rear centers by 63/34 mm from their original profiles. Ferrari rear pitch now follows the higher bumper area. AMG front centers move down 42/91 mm, with independent anchors kept on the actual bumper bridge. The compact carrier sits below the Mercedes badge's outer ring with approximately 10 mm of vertical clearance. Both holders independently sample the central projecting trim between the regular face samples to clear the bumper. Ferrari/Elantra front profiles, AMG rear profiles and both Prado profiles are unchanged.

## Verification

- Production build and all 14 verification suites passed. Existing Ferrari/Elantra acceleration and braking results remain unchanged.
- The plate suite decodes the actual shipped GLBs/Draco data and the actual Elantra showroom/wheel geometry. It checks 16 car/side/format combinations for outward orientation, bumper surface samples, two real anchor contacts, restrained bracket depths and clearance from the full vehicle geometry.
- Geometry checks verify both real sizes, sheet thickness, 1.5 mm embossed contours, raised border, flag/star, identity variants, non-emissive direct-light shader composition, finite coordinates/normals and ON/OFF restoration. Additional checks cover shared-source holder removal, registration-light switching and number/format edits on moved/rotated cars.
- Browser inspections covered every front/rear assembly in long and compact forms, side views, grazing light, direct light at night, both identity styles and plates disabled. No browser shader errors were reported. Follow-up checks cover all six adjusted holders with the final DIN lettering, open A counters, straight flags and Older/New presets.
- The live garage was checked for OFF hiding options, padded numeric groups, uppercase/filtered letters, hyphens, both formats, individual car settings, reload restoration and inspection views.
- Front/rear close-ups reserve the space beside the garage panel. At narrow widths the panel moves below the inspection area; both views were checked at 390 × 844 as well as the default desktop viewport. Returning to Whole Car clears the inspection projection.

The development inspector is `/scripts/plate-fit.html`; it is separate from the player interface. Local captures are under ignored `artifacts/license-plates/`, including long/compact contact sheets, rear edge views, night illumination and disabled source-holder cleanup. Plate detail is real geometry; overall vehicle fidelity remains bounded by the supplied vehicle meshes and the game's renderer.
