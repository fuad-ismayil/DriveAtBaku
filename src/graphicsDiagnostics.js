import { GpuTimer } from './gpuTimer.js';

// Opt-in visible counters for repeatable checks without a permanent gameplay UI.
export function createGraphicsDiagnostics(renderer, world, reflections, graphics, enabled) {
  if (!enabled) return { begin() {}, startGPU() {}, end() {} };
  const panel = document.createElement('pre');
  panel.id = 'graphics-diagnostics';
  panel.setAttribute('aria-label', 'Graphics diagnostics');
  Object.assign(panel.style, { position: 'fixed', top: '12px', right: '12px', zIndex: '1000',
    margin: '0', padding: '10px', background: '#09111de8', color: '#d6f5e8', font: '12px monospace', pointerEvents: 'none' });
  document.body.append(panel);
  const previousAutoReset = renderer.info.autoReset;
  renderer.info.autoReset = false;
  const samples = [];
  const gpuSamples = [], timer = new GpuTimer(renderer.getContext());
  const gl = renderer.getContext(), adapterInfo = gl.getExtension('WEBGL_debug_renderer_info');
  const adapter = adapterInfo ? gl.getParameter(adapterInfo.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  let gpuRow;
  let start = 0, previous = performance.now(), lastText = 0;
  return {
    begin() {
      timer.poll();
      gpuRow = {};
      renderer.info.reset(); start = performance.now();
      samples.push(start - previous); previous = start;
      if (samples.length > 120) samples.shift();
    },
    startGPU() {
      if (timer.begin('frame', gpuRow)) {
        gpuSamples.push(gpuRow);
        if (gpuSamples.length > 120) gpuSamples.shift();
      }
    },
    end() {
      timer.end(); timer.poll();
      const now = performance.now();
      if (now - lastText < 500) return;
      lastText = now;
      const ordered = [...samples].sort((a, b) => a - b);
      const gpu = gpuSamples.filter(row => !row.pending && !row.gpuInvalid && row.gpu)
        .map(row => row.gpu.frame).sort((a,b) => a-b);
      const settings = graphics.stats;
      panel.textContent = [
        `Quality: ${graphics.quality}`,
        `GPU: ${adapter}`,
        `Drawing buffer: ${settings.drawingBuffer.join(' x ')}; ${settings.renderingResolution}; DPR: ${devicePixelRatio}`,
        `AA: ${graphics.stats.samples}x MSAA + ${graphics.aoAvailable ? 'SMAA' : 'canvas AA'}; render scale: ${graphics.stats.renderScale}`,
        `Ambient occlusion: ${graphics.stats.ao ? 'on' : 'off'}; AO buffer: ${graphics.stats.aoSize.join(' x ')}`,
        `Frame interval median / p95: ${(ordered[Math.floor(ordered.length * 0.5)] ?? 0).toFixed(1)} / ${(ordered[Math.floor(ordered.length * 0.95)] ?? 0).toFixed(1)} ms`,
        `CPU frame submission: ${(now - start).toFixed(1)} ms (not GPU time)`,
        `GPU median / p95: ${gpu.length ? `${gpu[Math.ceil(gpu.length*.5)-1].toFixed(2)} / ${gpu[Math.ceil(gpu.length*.95)-1].toFixed(2)} ms` : timer.supported ? 'waiting for queries' : 'unsupported'}`,
        `GPU samples: ${gpu.length}; pending: ${timer.pending.length}; disjoint: ${timer.stats.disjoint}`,
        `World triangles: ${world.stats.triangles.toLocaleString()}`,
        `Released duplicate geometry: ${(world.stats.releasedCPUBytes / 1048576).toFixed(1)} MiB`,
        `Render objects / material batches: ${world.stats.renderObjects} / ${world.stats.batches}`,
        `Main-view candidate triangles: ${world.stats.mainTriangles.toLocaleString()}`,
        `World / props distance: ${world.distances.renderDistance} / ${world.distances.propsDistance} m`,
        `Chunks beyond distance / props: ${world.stats.distance} / ${world.stats.props}; skipped submissions: ${world.stats.skippedSubmissions}`,
        `Chunks outside view / occluded: ${world.stats.frustum} / ${world.stats.occluded}`,
        `Occlusion: ${world.occlusion ? 'on' : 'off'}; culling CPU: ${world.stats.milliseconds.toFixed(2)} ms`,
        `Opaque materials with backface culling: ${world.stats.singleSided}`,
        `Draws / triangles across all passes: ${renderer.info.render.calls} / ${renderer.info.render.triangles.toLocaleString()}`,
        `Reflection size / complete captures: ${reflections.stats.size} / ${reflections.stats.captures}`,
      ].join('\n');
    },
    dispose() { timer.dispose(); panel.remove(); renderer.info.autoReset = previousAutoReset; },
  };
}
