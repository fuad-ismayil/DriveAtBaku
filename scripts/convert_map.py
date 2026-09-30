"""Convert the supplied BeamNG/Collada Baku level into browser-ready GLB assets.

The source under levels/ is read-only. Generated assets go to public/generated/.
Requires trimesh, pycollada, Pillow and numpy (available in the Codex runtime).
"""
from __future__ import annotations

import json
import math
import re
from pathlib import Path

import collada
import numpy as np
import trimesh
from PIL import Image
from trimesh.visual.material import PBRMaterial

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "levels" / "baku"
MODEL_DIR = SOURCE / "art" / "baku"
OUTPUT = ROOT / "public" / "generated"
TEXTURE_OUTPUT = OUTPUT / "textures"


def semantic_colour(name: str) -> tuple[int, int, int, int]:
    n = name.lower()
    if any(word in n for word in ("water", "sea")):
        return (25, 103, 137, 255)
    if any(word in n for word in ("grass", "tree", "hedge")):
        return (58, 92, 54, 255)
    if any(word in n for word in ("road", "track", "tarmac", "asphalt")):
        return (61, 64, 67, 255)
    if any(word in n for word in ("glass", "window")):
        return (72, 105, 118, 220)
    if any(word in n for word in ("sand", "stone", "cobble", "brick")):
        return (154, 139, 111, 255)
    if any(word in n for word in ("white", "line")):
        return (215, 216, 207, 255)
    if any(word in n for word in ("tyre", "tire", "black")):
        return (30, 31, 32, 255)
    return (145, 148, 146, 255)


def texture_lookup() -> dict[str, Path]:
    result: dict[str, Path] = {}
    for path in MODEL_DIR.iterdir():
        if path.is_file():
            result[path.name.lower()] = path
            result[path.stem.lower()] = path
    return result


def diffuse_filename(material) -> str | None:
    diffuse = getattr(material.effect, "diffuse", None)
    image = getattr(getattr(getattr(diffuse, "sampler", None), "surface", None), "image", None)
    if image is None:
        return None
    raw = str(getattr(image, "path", ""))
    return re.split(r"[/\\]", raw)[-1].replace("%20", " ")


def optimized_texture(path: Path) -> tuple[Image.Image, bool]:
    TEXTURE_OUTPUT.mkdir(parents=True, exist_ok=True)
    with Image.open(path) as source:
        alpha = source.getchannel("A") if "A" in source.getbands() else None
        has_cutout = alpha is not None and alpha.getextrema()[0] < 250
    out = TEXTURE_OUTPUT / f"{path.stem.lower()}{'.png' if has_cutout else '.jpg'}"
    if not out.exists():
        with Image.open(path) as source:
            image = source.convert("RGBA" if has_cutout else "RGB")
            image.thumbnail((1024, 1024), Image.Resampling.LANCZOS)
            if has_cutout:
                image.save(out, "PNG", optimize=True)
            else:
                image.save(out, "JPEG", quality=82, optimize=True)
    return Image.open(out).copy(), has_cutout


def convert_visual(name: str) -> dict:
    dae_path = MODEL_DIR / f"{name}.dae"
    print(f"Reading {dae_path.relative_to(ROOT)}")
    dae = collada.Collada(str(dae_path))
    scene = trimesh.load(str(dae_path), force="scene")
    primitives = [primitive for geometry in dae.geometries for primitive in geometry.primitives]
    materials = {material.id: material for material in dae.materials}
    textures = texture_lookup()
    textured = 0
    cutouts = 0

    for index, mesh in enumerate(scene.geometry.values()):
        symbol = primitives[index].material if index < len(primitives) else ""
        source_material = materials.get(symbol)
        texture = None
        is_cutout = False
        if source_material:
            filename = diffuse_filename(source_material)
            if filename:
                source_texture = textures.get(filename.lower()) or textures.get(Path(filename).stem.lower())
                if source_texture:
                    try:
                        texture, is_cutout = optimized_texture(source_texture)
                        textured += 1
                        cutouts += int(is_cutout)
                    except Exception as exc:
                        print(f"Texture warning: {source_texture.name}: {exc}")
        kwargs = {
            "name": symbol or f"{name}-{index}",
            "baseColorFactor": (255, 255, 255, 255) if texture is not None else semantic_colour(symbol),
            "metallicFactor": 0.0,
            "roughnessFactor": 0.82,
            "doubleSided": True,
        }
        if texture is not None:
            kwargs["baseColorTexture"] = texture
        if is_cutout:
            kwargs["alphaMode"] = "MASK"
            kwargs["alphaCutoff"] = 0.42 if any(part in symbol.lower() for part in ("tree", "hedge", "grass_bridge")) else 10 / 255
        mesh.visual.material = PBRMaterial(**kwargs)

    out = OUTPUT / f"{name}.glb"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(scene.export(file_type="glb"))
    stats = {
        "source": str(dae_path.relative_to(ROOT)).replace("\\", "/"),
        "output": str(out.relative_to(ROOT)).replace("\\", "/"),
        "triangles": int(sum(len(mesh.faces) for mesh in scene.geometry.values())),
        "materials": len(primitives),
        "textured_materials": textured,
        "alpha_cutout_materials": cutouts,
        "size_mb": round(out.stat().st_size / 1024 / 1024, 2),
        "bounds": np.asarray(scene.bounds).round(3).tolist(),
    }
    print(json.dumps(stats, indent=2))
    return stats


def convert_collision() -> dict:
    dae_path = MODEL_DIR / "collision.dae"
    scene = trimesh.load(str(dae_path), force="scene")
    for mesh in scene.geometry.values():
        mesh.visual.material = PBRMaterial(
            name="collision", baseColorFactor=(255, 255, 255, 0), doubleSided=True
        )
    out = OUTPUT / "collision.glb"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(scene.export(file_type="glb"))
    return {
        "source": str(dae_path.relative_to(ROOT)).replace("\\", "/"),
        "output": str(out.relative_to(ROOT)).replace("\\", "/"),
        "triangles": int(sum(len(mesh.faces) for mesh in scene.geometry.values())),
        "size_mb": round(out.stat().st_size / 1024 / 1024, 2),
        "bounds": np.asarray(scene.bounds).round(3).tolist(),
    }


def write_route() -> None:
    race_path = SOURCE / "quickrace" / "quickrace.race.json"
    spawn_path = SOURCE / "main" / "MissionGroup" / "PlayerDropPoints" / "items.level.json"
    race = json.loads(race_path.read_text(encoding="utf-8"))
    spawn = json.loads(spawn_path.read_text(encoding="utf-8").splitlines()[0])
    data = {
        "name": race["name"],
        "lengthKm": 6.003,
        "spawn": spawn["position"],
        "heading": math.atan2(
            -(race["pathnodes"][1]["pos"][0] - race["pathnodes"][0]["pos"][0]),
            race["pathnodes"][1]["pos"][1] - race["pathnodes"][0]["pos"][1],
        ),
        "checkpoints": [node["pos"] for node in race["pathnodes"]],
    }
    (OUTPUT / "route.json").write_text(json.dumps(data, indent=2), encoding="utf-8")


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    reports = [convert_visual("baku"), convert_visual("buildings"), convert_collision()]
    write_route()
    (OUTPUT / "conversion-report.json").write_text(json.dumps(reports, indent=2), encoding="utf-8")
    print("Baku browser assets ready.")


if __name__ == "__main__":
    main()
