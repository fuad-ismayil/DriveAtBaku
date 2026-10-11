import * as THREE from 'three';
import { SpatialIndex } from './spatialIndex.js';

export class GroundSampler {
  constructor(meshes) {
    const entries = meshes.map((mesh, order) => {
      mesh.geometry.computeBoundingBox();
      const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      const name = `${mesh.name} ${material?.name ?? ''}`;
      const mu = /grass|dirt|sand/i.test(name) ? 0.65 : /gravel/i.test(name) ? 0.75 : 1;
      return { mesh, order, bounds: mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld), mu, rr: mu < 1 ? 0.045 : 0.013 };
    });
    this.index = new SpatialIndex(entries);
    this.raycaster = new THREE.Raycaster();
    this.raycaster.firstHitOnly = true;
    this.queryBounds = new THREE.Box3();
    this.end = new THREE.Vector3();
    this.candidates = [];
    this.hits = [];
    this.intersectsQuery = bounds => bounds.intersectsBox(this.queryBounds);
  }

  sample(origin, direction, maxDistance) {
    const raycaster = this.raycaster;
    raycaster.set(origin, direction); raycaster.near = 0; raycaster.far = maxDistance;
    this.end.copy(origin).addScaledVector(direction, maxDistance);
    this.queryBounds.makeEmpty().expandByPoint(origin).expandByPoint(this.end).expandByScalar(1e-6);
    this.index.query(this.intersectsQuery, this.candidates);
    let best = null, surface = null;
    for (const entry of this.candidates) {
      this.hits.length = 0;
      raycaster.intersectObject(entry.mesh, false, this.hits);
      const hit = this.hits[0];
      if (hit && (!best || hit.distance < best.distance || (hit.distance === best.distance && entry.order < surface.order))) {
        best = hit; surface = entry;
      }
    }
    if (!best) return null;
    const normal = best.face?.normal?.clone().transformDirection(best.object.matrixWorld) ?? new THREE.Vector3(0, 0, 1);
    if (normal.z < 0) normal.negate();
    return { distance: best.distance, point: best.point, normal, mu: surface.mu, rr: surface.rr };
  }
}
