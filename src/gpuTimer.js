// Asynchronous WebGL2 timing. Results are nanoseconds from the GPU, never CPU
// wall-clock time. A disjoint invalidates ALL outstanding queries in that epoch.
export class GpuTimer {
  constructor(gl, { maxPending = 256 } = {}) {
    this.gl = gl;
    this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    this.maxPending = maxPending;
    this.pending = [];
    this.active = null;
    this.stats = { issued: 0, completed: 0, disjoint: 0, dropped: 0, contextLost: 0 };
  }
  get supported() { return Boolean(this.ext); }
  begin(label, owner) {
    if (!this.ext) return false;
    if (this.active) { owner.gpuInvalid = true; return false; }
    if (this.gl.isContextLost()) { this.stats.contextLost++; owner.gpuInvalid = true; return false; }
    if (this.pending.length >= this.maxPending) { this.stats.dropped++; owner.gpuInvalid = true; return false; }
    const query = this.gl.createQuery();
    if (!query) { owner.gpuInvalid = true; return false; }
    this.active = { query, label, owner };
    owner.pending = (owner.pending ?? 0) + 1;
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, query);
    this.stats.issued++;
    return true;
  }
  end() {
    if (!this.active) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push(this.active);
    this.active = null;
  }
  poll() {
    if (!this.ext) return;
    if (this.gl.isContextLost()) { this.stats.contextLost++; this.discard(); return; }
    if (this.gl.getParameter(this.ext.GPU_DISJOINT_EXT)) {
      this.stats.disjoint++;
      this.discard();
      return;
    }
    while (this.pending.length) {
      const item = this.pending[0];
      if (!this.gl.getQueryParameter(item.query, this.gl.QUERY_RESULT_AVAILABLE)) break;
      const milliseconds = this.gl.getQueryParameter(item.query, this.gl.QUERY_RESULT) / 1e6;
      item.owner.gpu ??= {};
      item.owner.gpu[item.label] = (item.owner.gpu[item.label] ?? 0) + milliseconds;
      item.owner.pending--;
      this.gl.deleteQuery(item.query);
      this.pending.shift();
      this.stats.completed++;
    }
  }
  discard() {
    this.end();
    for (const item of this.pending) {
      item.owner.gpuInvalid = true;
      item.owner.pending--;
      this.gl.deleteQuery(item.query);
    }
    this.pending.length = 0;
  }
  dispose() { this.discard(); }
}
