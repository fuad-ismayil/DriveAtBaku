// Opt-in visible counters for repeatable checks without a permanent gameplay UI.
export function createGraphicsDiagnostics(renderer, world, reflections, graphics, enabled) {
  if (!enabled) return { begin() {}, end() {} };
  const panel = document.createElement('pre');
  panel.id = 'graphics-diagnostics';
  panel.setAttribute('aria-label', 'Graphics diagnostics');
  Object.assign(panel.style, { position: 'fixed', top: '12px', right: '12px', zIndex: '1000',
    margin: '0', padding: '10px', background: '#09111de8', color: '#d6f5e8', font: '12px monospace', pointerEvents: 'none' });
  document.body.append(panel);
  renderer.info.autoReset = false;
  const samples = [];
  let start = 0, previous = performance.now(), lastText = 0;
  return {
    begin() {
      renderer.info.reset(); start = performance.now();
      samples.push(start - previous); previous = start;
      if (samples.length > 120) samples.shift();
    },
    end() {
      const now = performance.now();
      if (now - lastText < 500) return;
      lastText = now;
      const ordered = [...samples].sort((a, b) => a - b);
      panel.textContent = [
        `Quality: ${graphics.quality}`,
        `Frame interval median / p95: ${(ordered[Math.floor(ordered.length * 0.5)] ?? 0).toFixed(1)} / ${(ordered[Math.floor(ordered.length * 0.95)] ?? 0).toFixed(1)} ms`,
        `CPU frame submission: ${(now - start).toFixed(1)} ms (not GPU time)`,
        `World triangles: ${world.stats.triangles.toLocaleString()}`,
        `Render objects / material batches: ${world.stats.renderObjects} / ${world.stats.batches}`,
        `Main-view candidate triangles: ${world.stats.mainTriangles.toLocaleString()}`,
        `Chunks outside view / occluded: ${world.stats.frustum} / ${world.stats.occluded}`,
        `Occlusion: ${world.occlusion ? 'on' : 'off'}; culling CPU: ${world.stats.milliseconds.toFixed(2)} ms`,
        `Opaque materials with backface culling: ${world.stats.singleSided}`,
        `Draws / triangles across all passes: ${renderer.info.render.calls} / ${renderer.info.render.triangles.toLocaleString()}`,
        `Reflection size / complete captures: ${reflections.stats.size} / ${reflections.stats.captures}`,
      ].join('\n');
    },
  };
}
