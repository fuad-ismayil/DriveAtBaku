export function distribution(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const percentile = p => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)];
  return { count: sorted.length, mean: sorted.reduce((a,b) => a+b, 0) / sorted.length,
    median: percentile(.5), p95: percentile(.95), p99: percentile(.99), max: sorted.at(-1) };
}
export function summarizeFrames(rows) {
  const metrics = {};
  const counters = new Set(['useProgram','linkProgram','bufferData','bufferSubData','texImage2D','texSubImage2D','bufferUploadBytes']);
  for (const key of new Set(rows.flatMap(row => Object.keys(row)))) {
    if (key === 'gpu' || key === 'pending' || key === 'gpuInvalid') continue;
    const summary = distribution(rows.map(row => counters.has(key) ? row[key] ?? 0 : row[key]));
    if (summary) metrics[key] = summary;
  }
  const valid = rows.filter(row => !row.gpuInvalid && !row.pending && row.gpu);
  metrics.gpu = distribution(valid.map(row => Object.values(row.gpu).reduce((a,b) => a+b, 0)));
  const passes = {};
  for (const label of new Set(valid.flatMap(row => Object.keys(row.gpu)))) {
    // Include zero on frames where scheduled work does not run; active cost is
    // reported separately so a rare PMREM spike is not hidden by the median.
    passes[label] = { perFrame: distribution(valid.map(row => row.gpu[label] ?? 0)),
      active: distribution(valid.map(row => row.gpu[label])) };
  }
  const intervals = rows.map(row => row.interval).filter(value => Number.isFinite(value) && value > 0);
  const slowest = [...intervals].sort((a,b) => b-a).slice(0, Math.max(1, Math.ceil(intervals.length * .01)));
  const total = intervals.reduce((a,b) => a+b, 0);
  return { metrics, passes, fps: { average: total ? intervals.length * 1000 / total : null,
    median: metrics.interval ? 1000 / metrics.interval.median : null,
    onePercentLow: slowest.length ? 1000 / (slowest.reduce((a,b) => a+b, 0) / slowest.length) : null },
    stutters: { over33ms: intervals.filter(ms => ms > 33.333).length,
      over50ms: intervals.filter(ms => ms > 50).length, over100ms: intervals.filter(ms => ms > 100).length,
      worstMs: intervals.length ? Math.max(...intervals) : null }, gpuValidFrames: valid.length };
}
