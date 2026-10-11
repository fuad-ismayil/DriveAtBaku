import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const root='artifacts/engine-investigation';
const read=name=>JSON.parse(readFileSync(`${root}/${name}/comparison.json`));
const native=read('native-iris'),city=read('final'),rtx=read('render-range-rtx'),windows=read('maximized-iris'),dpr=read('dpr-native-iris');
const fixed=native.rows.find(r=>r.quality==='balanced'),old=fixed.before,next=fixed.after;
const fmt=n=>Number.isFinite(n)?n.toFixed(2):'Unavailable';
const change=(a,b)=>`${fmt(Math.abs(b/a-1)*100)}% ${b<a?'lower':'higher'}`;
const row=(label,a,b,lower=true)=>`| ${label} | ${fmt(a)} | ${fmt(b)} | ${change(a,b,lower)} |`;
const perf=native.rows.find(r=>r.quality==='performance'),cinema=native.rows.find(r=>r.quality==='cinematic'),low=city.rows.find(r=>r.height===720&&r.scenario==='idle');
const resources=native.resources.filter(r=>r.height===1080&&r.quality==='balanced');
const beforeResource=resources.find(r=>r.variant==='baseline'),afterResource=resources.find(r=>r.variant==='current');
const lines=[
  'Headline reference: Ferrari, stationary city view, Sunny/day, lights off, AO on, Balanced, **Native 1920×1080**, DPR 1, scale 1, 2x HDR MSAA + SMAA, Chrome 155 / ANGLE D3D11 on **Intel Iris Xe**, hardware accelerated. Each version warmed 60 frames and measured 180 frames twice (360 valid GPU results); real frame intervals exclude each sample\'s first undefined interval. The seven-scenario comparison additionally used before/after/after/before context ordering. The 720p row below comes from that separate repeated full-view comparison.',
  '', '| Metric | Before | After | Change |','| --- | ---: | ---: | --- |',
  row('1080p Balanced average FPS',old.fps.average,next.fps.average,false),
  row('1080p Balanced median FPS',old.fps.median,next.fps.median,false),
  row('1080p Balanced GPU median (ms)',old.metrics.gpu.median,next.metrics.gpu.median),
  row('1080p Balanced GPU p95 (ms)',old.metrics.gpu.p95,next.metrics.gpu.p95),
  row('1080p Balanced frame median (ms)',old.metrics.interval.median,next.metrics.interval.median),
  row('1080p Balanced frame p95 (ms)',old.metrics.interval.p95,next.metrics.interval.p95),
  row('1080p Balanced frame p99 (ms)',old.metrics.interval.p99,next.metrics.interval.p99),
  row('1080p Balanced 1% low FPS',old.fps.onePercentLow,next.fps.onePercentLow,false),
  row('1080p Balanced CPU main-frame median (ms)',old.metrics.cpu.median,next.metrics.cpu.median),
  row('1080p Balanced CPU render submission median (ms)',old.metrics['cpu.render'].median,next.metrics['cpu.render'].median),
  row('1080p Performance GPU median (ms)',perf.before.metrics.gpu.median,perf.after.metrics.gpu.median),
  row('1080p Cinematic GPU median (ms)',cinema.before.metrics.gpu.median,cinema.after.metrics.gpu.median),
  row('720p Balanced GPU median (ms)',low.before.metrics.gpu.median,low.after.metrics.gpu.median),
  row('All-pass draw calls',old.metrics.calls.median,next.metrics.calls.median),
  row('All-pass rendered triangles',old.metrics.triangles.median,next.metrics.triangles.median),
  row('Tracked offscreen attachments (estimated MiB)',beforeResource.estimatedRenderTargetMiB,afterResource.estimatedRenderTargetMiB),
  '', 'Performance\'s small negative delta is reported honestly; its direct rendering path has no fullscreen post effects to remove. All-pass triangle reduction represents the two removed fullscreen triangles; authored world geometry is unchanged. Resource estimates are a tracked subset, not total VRAM. Shader/program inventory can increase when otherwise cold effect variants are prepared early.',
  '',`In this Native sample, intervals over 50 ms fell from **${old.stutters.over50ms} to ${next.stutters.over50ms} / ${old.metrics.interval.count} measured intervals**; worst interval was **${fmt(old.stutters.worstMs)} → ${fmt(next.stutters.worstMs)} ms**. These are short-run counts, not a long-session guarantee.`,
  '', '| Repeated Balanced 1080p scenario | GPU before / after (ms) | Average FPS before / after | GPU reduction |','| --- | ---: | ---: | ---: |',
  ...city.rows.filter(r=>r.height===1080).map(r=>`| ${r.scenario} | ${fmt(r.before.metrics.gpu.median)} / ${fmt(r.after.metrics.gpu.median)} | ${fmt(r.before.fps.average)} / ${fmt(r.after.fps.average)} | ${fmt(r.gpuReductionPercent)}% |`),
  '', 'The urban row is a stationary checkpoint-7 view; drive/fast/night/rain are short deterministic spawn replays. An additional dense urban drive and low-beam night replay is recorded separately. Each scenario\'s raw JSON also contains FPS median, 1% low, median/p95/p99 interval, GPU p95, CPU phases, draw/triangle counts, program switches/uploads, heap and stutter counts.',
  '', 'The separate RTX runs retain the same 1080p workload, without treating GPU selection as a code speedup. Representative repeated results:',
  '', '| RTX 3050, 1080p | GPU before / after (ms) | Average FPS before / after |','| --- | ---: | ---: |',
  ...rtx.rows.filter(r=>r.height===1080).map(r=>`| ${r.quality} / ${r.scenario} | ${fmt(r.before.metrics.gpu.median)} / ${fmt(r.after.metrics.gpu.median)} | ${fmt(r.before.fps.average)} / ${fmt(r.after.fps.average)} |`),
  '', 'RTX whole-render elapsed timings remain close, including small regressions in some cells, while the isolated output/bloom draws are measurably removed. No universal RTX GPU-time improvement is claimed. Approximately 144 Hz frame pacing limits stationary FPS; CPU/submission and occasional first-use events limit some driving rows.',
  '', '| Actual maximized Chrome, Iris Xe | Buffer | GPU before / after (ms) | Average FPS before / after |','| --- | --- | ---: | ---: |',
  ...windows.rows.filter(r=>r.height===1080).map(r=>`| ${r.quality} / ${r.scenario} | 1920×945 | ${fmt(r.before.metrics.gpu.median)} / ${fmt(r.after.metrics.gpu.median)} | ${fmt(r.before.fps.average)} / ${fmt(r.after.fps.average)} |`),
  '', `The emulated DPR 1.5 Native Balanced test at **1920×1080 CSS** produced **2880×1620 actual buffers**: GPU median **${fmt(dpr.rows[0].before.metrics.gpu.median)} → ${fmt(dpr.rows[0].after.metrics.gpu.median)} ms** on Iris Xe. This is a larger-than-1080p workload; it is not used as the native-1080p headline. Fixed choices were separately verified at DPR 1 / 1.25 / 1.5 / 2.`,
  '', `Raw evidence: [Native Iris](../${root}/native-iris/results.json), [Iris full scenario comparison](../${root}/final/results.json), [RTX full matrix](../${root}/rtx-matrix/results.json), [RTX repeated CPU/GPU samples](../${root}/render-range-rtx/results.json), [RTX pass profile](../${root}/rtx-passes/results.json), [maximized Iris](../${root}/maximized-iris/results.json), [DPR test](../${root}/dpr-native-iris/results.json), [resolution/window/resource checks](../${root}/resolution/results.json), and [matched image comparison](../${root}/final/comparison.json).`,
];
if(existsSync(`${root}/ab-prewarm/results.json`)){
  const p=JSON.parse(readFileSync(`${root}/ab-prewarm/results.json`));
  lines.push('','The separate tire-effect warm-up experiment compares the already optimized renderer against the additional startup warm-up:','',
    '| Warm-up experiment, 1080p Balanced drive | Shader links during measurement | Peak CPU (ms) | Peak uploaded buffer bytes |','| --- | ---: | ---: | ---: |',
    ...p.samples.map(s=>`| ${s.variant} / repeat ${s.repeat} | ${s.rows.reduce((sum,r)=>sum+(r.linkProgram??0),0)} | ${fmt(s.metrics.cpu.max)} | ${s.metrics.bufferUploadBytes?.max??0} |`),
    '', 'The fresh cold run linked one shader and allocated the 344,064-byte tire-mark buffers. Prepared runs linked none and used the existing small range uploads. The second unprepared replay already had its shader cached. This demonstrates removal of that first-use event; steady-state GPU/frame-pacing savings are not assigned to warm-up. Buffer counters account for WebGL2 source offset/length; earlier exploratory counters counted backing arrays and should not be read as actual transferred bytes.');
}
if(existsSync(`${root}/dense-night-rtx/comparison.json`)){
  const dense=read('dense-night-rtx');
  lines.push('','Additional genuine RTX 1080p replays on the completed warm-up source:', '',
    '| Preset / replay | GPU before / after (ms) | Average FPS before / after |','| --- | ---: | ---: |',
    ...dense.rows.map(r=>`| ${r.quality} / ${r.scenario} | ${fmt(r.before.metrics.gpu.median)} / ${fmt(r.after.metrics.gpu.median)} | ${fmt(r.before.fps.average)} / ${fmt(r.after.fps.average)} |`),
    '', 'These are single short samples per cell, including real checkpoint-7 driving and night driving with low beams. They confirm playable 1080p on this adapter, and retain the cells with small regressions. Raw evidence: dense/night replay: `engine-investigation/dense-night-rtx/results.json` (local evidence under artifacts/).');
}
if(existsSync(`${root}/completed-source/comparison.json`)){
  const final=read('completed-source'),sample=final.rows[0];
  lines.push('','A final current-source 1080p Native check after adding shader warm-up measured GPU median **'+fmt(sample.before.metrics.gpu.median)+' → '+fmt(sample.after.metrics.gpu.median)+' ms** on Iris Xe (one 120-frame sample per version). This agrees with the longer renderer comparison; it is not substituted for its repeated headline. The five matched captures remain visually consistent. Final-source results and image comparison: `engine-investigation/completed-source/comparison.json` (local evidence under artifacts/).');
}
const path='docs/history/ENGINE_PERFORMANCE_INVESTIGATION.md';let doc=readFileSync(path,'utf8');
doc=doc.replace(/<!-- MEASUREMENTS_START -->[\s\S]*?<!-- MEASUREMENTS_END -->/,'<!-- MEASUREMENTS_START -->\n'+lines.join('\n')+'\n<!-- MEASUREMENTS_END -->');
writeFileSync(path,doc);console.log('Updated measured engine report from raw comparisons.');
