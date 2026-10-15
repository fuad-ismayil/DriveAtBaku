import * as THREE from 'three';

const WIDTH = 7.2, HEIGHT = 3.6, COLUMNS = 32, ROWS = 16;
const STEP = 1 / 120, ITERATIONS = 16;

// Position-based cloth: structural/shear constraints preserve the printed
// flag's proportions, while softer bending constraints let folds travel freely.
export function createFlagCloth() {
  const geometry = new THREE.PlaneGeometry(WIDTH, HEIGHT, COLUMNS, ROWS)
    .rotateX(Math.PI / 2).translate(WIDTH / 2, 0, -HEIGHT / 2);
  const attribute = geometry.getAttribute('position');
  attribute.setUsage(THREE.DynamicDrawUsage);
  geometry.getAttribute('normal').setUsage(THREE.DynamicDrawUsage);
  const positions = attribute.array, previous = positions.slice(), rest = positions.slice();
  const links = [], stride = COLUMNS + 1;
  for (let row = 0; row <= ROWS; row++) for (let col = 0; col <= COLUMNS; col++) {
    const p = (row * stride + col) * 3;
    positions[p] = previous[p] = rest[p] = col / COLUMNS * WIDTH;
    positions[p + 1] = previous[p + 1] = rest[p + 1] = 0;
    positions[p + 2] = previous[p + 2] = rest[p + 2] = -row / ROWS * HEIGHT;
  }
  const link = (a, b, stiffness, stretchOnly = false) => {
    const distance = Math.hypot(rest[a * 3] - rest[b * 3], rest[a * 3 + 1] - rest[b * 3 + 1], rest[a * 3 + 2] - rest[b * 3 + 2]);
    links.push({ a: a * 3, b: b * 3, distance, stiffness, stretchOnly, wa: a % stride ? 1 : 0, wb: b % stride ? 1 : 0 });
  };
  for (let row = 0; row <= ROWS; row++) for (let col = 0; col <= COLUMNS; col++) {
    const i = row * stride + col;
    // Long-range tethers transfer tension from the pole without resisting
    // compression into folds or allowing accumulated stretch across a row.
    if (col > 0) link(row * stride, i, 1, true);
    if (col < COLUMNS) link(i, i + 1, 1);
    if (row < ROWS) link(i, i + stride, 1);
    if (col < COLUMNS && row < ROWS) { link(i, i + stride + 1, .8); link(i + 1, i + stride, .8); }
    if (col + 2 <= COLUMNS) link(i, i + 2, .12);
    if (row + 2 <= ROWS) link(i, i + stride * 2, .12);
  }
  let time = 0, accumulator = 0;

  function step() {
    time += STEP;
    const normals = geometry.getAttribute('normal').array;
    // Slowly varying gusts and direction, with smaller eddies convecting from
    // the hoist to the fly. Pressure acts on each patch's current surface normal.
    const speed = 6.6 + 1.0 * Math.sin(time * .53) + .45 * Math.sin(time * 1.17 + .8);
    const crosswind = 1.1 + .7 * Math.sin(time * .37 + .4);
    const damping = Math.exp(-1.3 * STEP), pressureScale = .5 * 1.225 / .12;
    for (let i = 0; i < attribute.count; i++) {
      if (i % stride === 0) continue;
      const p = i * 3, x = positions[p], y = positions[p + 1], z = positions[p + 2];
      const vx = (x - previous[p]) / STEP, vy = (y - previous[p + 1]) / STEP, vz = (z - previous[p + 2]) / STEP;
      const eddy = .65 * Math.sin(time * 3.1 - rest[p] * 1.5 + rest[p + 2] * .65)
        + .25 * Math.sin(time * 5.3 - rest[p] * 2.7 - rest[p + 2] * 1.1);
      const wx = speed - vx, wy = crosswind + eddy - vy, wz = .35 * Math.sin(time * .71) - vz;
      const nx = normals[p], ny = normals[p + 1], nz = normals[p + 2];
      const normalSpeed = THREE.MathUtils.clamp(wx * nx + wy * ny + wz * nz, -12, 12);
      const pressure = pressureScale * normalSpeed * Math.abs(normalSpeed);
      previous[p] = x; previous[p + 1] = y; previous[p + 2] = z;
      positions[p] = x + vx * STEP * damping + (nx * pressure + wx * .45) * STEP * STEP;
      positions[p + 1] = y + vy * STEP * damping + (ny * pressure + wy * .45) * STEP * STEP;
      positions[p + 2] = z + vz * STEP * damping + (nz * pressure + wz * .45 - 9.81) * STEP * STEP;
    }
    for (let pass = 0; pass < ITERATIONS; pass++) {
      // Alternate traversal so the constraint solver has no persistent pull
      // toward one corner. Pinned particles have zero inverse mass.
      for (let j = 0; j < links.length; j++) {
        const { a, b, distance, stiffness, stretchOnly, wa, wb } = links[pass % 2 ? links.length - 1 - j : j];
        const weight = wa + wb;
        if (!weight) continue;
        const dx = positions[b] - positions[a], dy = positions[b + 1] - positions[a + 1], dz = positions[b + 2] - positions[a + 2];
        const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if ((stretchOnly && length <= distance) || length < 1e-8) continue;
        const correction = (length - distance) / length * stiffness / weight;
        positions[a] += dx * correction * wa; positions[a + 1] += dy * correction * wa; positions[a + 2] += dz * correction * wa;
        positions[b] -= dx * correction * wb; positions[b + 1] -= dy * correction * wb; positions[b + 2] -= dz * correction * wb;
      }
    }
    geometry.computeVertexNormals();
  }

  // Start with settled fabric rather than a rigid rectangle on the first frame.
  for (let i = 0; i < 240; i++) step();
  attribute.needsUpdate = true;
  // Every row is pinned at x=y=0; its free particles can travel at most one
  // flag width from that attachment. Include this envelope in world culling.
  const bounds = new THREE.Box3(new THREE.Vector3(-WIDTH - .2, -WIDTH - .2, -HEIGHT - WIDTH - .2),
    new THREE.Vector3(WIDTH + .2, WIDTH + .2, WIDTH + .2));
  geometry.boundingBox = bounds.clone(); bounds.getBoundingSphere(geometry.boundingSphere = new THREE.Sphere());
  return {
    geometry, bounds,
    update(dt) {
      if (!Number.isFinite(dt) || dt <= 0) return;
      accumulator += Math.min(dt, .1);
      let changed = false;
      while (accumulator + 1e-10 >= STEP) { step(); accumulator -= STEP; changed = true; }
      if (changed) attribute.needsUpdate = true;
    },
  };
}
