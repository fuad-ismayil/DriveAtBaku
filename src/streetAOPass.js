import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';

// Keep MSAA on the scene alone; fullscreen effects use single-sample buffers.
export class StreetScenePass extends Pass {
  constructor(scene, camera, samples) {
    super();
    this.needsSwap = false;
    this.target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType, samples,
      depthTexture: new THREE.DepthTexture(1, 1, THREE.UnsignedIntType),
    });
    this.scenePass = new RenderPass(scene, camera);
    this.copy = new THREE.ShaderMaterial({
      uniforms: { tScene: { value: this.target.texture } },
      vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: 'uniform sampler2D tScene;varying vec2 vUv;void main(){gl_FragColor=texture2D(tScene,vUv);}',
      depthTest: false, depthWrite: false, toneMapped: false,
    });
    this.quad = new FullScreenQuad(this.copy);
  }
  setSize(width, height) { this.target.setSize(width, height); }
  render(renderer, writeBuffer, readBuffer) {
    this.scenePass.render(renderer, writeBuffer, this.target);
    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
    this.quad.render(renderer);
  }
  dispose() { this.target.dispose(); this.copy.dispose(); this.quad.dispose(); this.scenePass.dispose(); }
}

export class StreetAOPass extends GTAOPass {
  constructor(scene, camera, depthTexture) {
    super(scene, camera, 1, 1);
    // Reconstruct geometric normals from the actual beauty depth. Alpha-tested
    // openings, batching, culling, skinning and animated wheels match that view.
    // Sky, glass and precipitation do not write depth and do not occlude it.
    this.setGBuffer(depthTexture);
    this.gtaoMaterial.needsUpdate = this.pdMaterial.needsUpdate = true;
    this.blendIntensity = 0.48;
    this.updateGtaoMaterial({ radius: 0.65, thickness: 0.18, distanceFallOff: 1.5, samples: 16 });
    this.updatePdMaterial({ radius: 4, depthPhi: 2, normalPhi: 3, samples: 16 });
  }
  setSize(width, height) { super.setSize(Math.max(1, Math.round(width / 2)), Math.max(1, Math.round(height / 2))); }
  dispose() {
    super.dispose();
    // These two materials are not released by the r180 base implementation.
    this.gtaoMaterial.dispose(); this.blendMaterial.dispose();
  }
}
