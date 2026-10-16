"""Measure unmodified S9 captures and recordings; emit a comparison sheet."""
import json
import wave
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

output = Path("artifacts/android/audio-plate-device")
source = output / "files/audio-plate-qa"
stats, rows = {}, []
for car in ("ferrari", "elantra", "amg", "prado"):
    for plate_format in ("long", "compact"):
        row = Image.new("RGB", (960, 200), "#10151b")
        draw = ImageDraw.Draw(row)
        levels = []
        for mode, label in enumerate(("OFF", "LOW", "HIGH")):
            picture = Image.open(source / f"{car}_{plate_format}_{mode}.png").convert("RGB")
            width, height = picture.size
            pixels = np.asarray(picture.crop((int(width * .3), int(height * .4), int(width * .7), int(height * .6))), dtype=float)
            levels.append(float(np.mean(pixels @ np.array([.2126, .7152, .0722]))))
            row.paste(picture.resize((320, 156)), (mode * 320, 30))
            draw.text((mode * 320 + 7, 8), f"{car} {plate_format} {label}", fill="white")
        same = (source / f"{car}_{plate_format}_1.png").read_bytes() == (source / f"{car}_{plate_format}_2.png").read_bytes()
        stats[f"{car}_{plate_format}"] = {"plate_luminance_8bit": levels, "high_low_identical": same}
        assert levels[1] > levels[0] * 2 and same
        rows.append(row)
sheet = Image.new("RGB", (960, 200 * len(rows)))
for index, row in enumerate(rows):
    sheet.paste(row, (0, index * 200))
sheet.save(output / "plate-comparison.jpg")

baseline = Path("artifacts/android/visual/native-idle.wav")
for filename in ([baseline] if baseline.exists() else []) + list(source.glob("idle_*.wav")):
    with wave.open(str(filename)) as audio:
        rate, channels = audio.getframerate(), audio.getnchannels()
        signal = np.frombuffer(audio.readframes(audio.getnframes()), dtype="<i2").reshape(-1, channels).astype(float) / 32768
    # Compare settled audio, excluding the historical startup fade.
    signal = signal[int(rate * (5 if filename == baseline else 1)):]
    steps = np.abs(np.diff(signal, axis=0))
    result = {"rms": float(np.sqrt(np.mean(signal * signal))), "peak": float(np.abs(signal).max()),
              "max_sample_step": float(steps.max()), "steps_over_0.002": int(np.sum(steps > .002)),
              "clipped_samples": int(np.sum(np.abs(signal) > .999))}
    stats[filename.name] = result
    if filename != baseline:
        assert result["steps_over_0.002"] == 0 and result["clipped_samples"] == 0 and result["rms"] > .03
(output / "analysis.json").write_text(json.dumps(stats, indent=2))
print(json.dumps(stats, indent=2))
