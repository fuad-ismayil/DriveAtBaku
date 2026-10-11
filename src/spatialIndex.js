import * as THREE from 'three';

// Static AABB hierarchy. Large and overlapping surfaces retain their full bounds.
export class SpatialIndex {
  constructor(entries, leafSize = 8) {
    this.entries = [...entries];
    const build = (start, end) => {
      const bounds = new THREE.Box3();
      for (let i = start; i < end; i++) bounds.union(this.entries[i].bounds);
      const node = { bounds, start, end, left: null, right: null };
      if (end - start > leafSize) {
        const size = bounds.getSize(new THREE.Vector3());
        const axis = size.x >= size.y && size.x >= size.z ? 'x' : size.y >= size.z ? 'y' : 'z';
        const sorted = this.entries.slice(start, end).sort((a, b) =>
          (a.bounds.min[axis] + a.bounds.max[axis]) - (b.bounds.min[axis] + b.bounds.max[axis]));
        for (let i = start; i < end; i++) this.entries[i] = sorted[i - start];
        const middle = (start + end) >>> 1;
        node.left = build(start, middle); node.right = build(middle, end);
      }
      return node;
    };
    this.root = entries.length ? build(0, entries.length) : null;
    this.stack = [];
  }

  query(intersects, output) {
    output.length = 0;
    const stack = this.stack;
    stack.length = 0;
    if (this.root) stack.push(this.root);
    while (stack.length) {
      const node = stack.pop();
      if (!intersects(node.bounds)) continue;
      if (node.left) { stack.push(node.left, node.right); continue; }
      for (let i = node.start; i < node.end; i++) {
        const entry = this.entries[i];
        if (intersects(entry.bounds)) output.push(entry);
      }
    }
    return output;
  }
}
