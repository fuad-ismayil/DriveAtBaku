"""Extract the user-supplied showroom mesh bundle for the local game.

Usage: python scripts/extract_elantra.py "C:/path/to/elantra.html"
The HTML is only read; its embedded gzip payload is copied without alteration.
"""

import base64
import gzip
import json
import sys
from pathlib import Path


source = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.home() / "Desktop/car showcase/elantra.html"
output = Path(__file__).resolve().parents[1] / "public/assets/vehicles/elantra-showroom.bin"

with source.open(encoding="utf-8") as showroom:
    line = next((line for line in showroom if 'id="modelData"' in line), None)
if line is None:
    raise SystemExit(f"No embedded car mesh was found in {source}")

payload = base64.b64decode(line.split(">", 1)[1].split("</script>", 1)[0])
model = json.loads(gzip.decompress(payload))
if not model.get("meshes") or not model.get("wheels"):
    raise SystemExit("The embedded model is incomplete")

output.parent.mkdir(parents=True, exist_ok=True)
output.write_bytes(payload)
print(f"Extracted {len(model['meshes'])} mesh parts and {len(model['wheels'])} wheels to {output}")
