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
  }
  setSize(width, height) { this.target.setSize(width, height); }
  render(renderer) {
    this.scenePass.render(renderer, null, this.target);
  }
  copyTo(renderer, target) {
    this.copy ??= new THREE.ShaderMaterial({
      uniforms: { tScene: { value: this.target.texture } },
      vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: 'uniform sampler2D tScene;varying vec2 vUv;void main(){gl_FragColor=texture2D(tScene,vUv);}',
      depthTest: false, depthWrite: false, toneMapped: false,
    });
    this.copyQuad ??= new FullScreenQuad(this.copy);
    renderer.setRenderTarget(target); this.copyQuad.render(renderer);
  }
  dispose() { this.target.dispose(); this.scenePass.dispose(); this.copy?.dispose(); this.copyQuad?.dispose(); }
}

export class StreetAOPass extends GTAOPass {
  constructor(scene, camera, depthTexture) {
    super(scene, camera, 1, 1);
    // Reconstruct geometric normals from the actual beauty depth. Alpha-tested
    // openings, batching, culling, skinning and animated wheels match that view.
    // Sky, glass and precipitation do not write depth and do not occlude it.
    this.setGBuffer(depthTexture);
    this.gtaoRenderTarget.depthBuffer = this.pdRenderTarget.depthBuffer = false;
    // The external beauty depth replaces this unused normal/depth attachment.
    this.normalRenderTarget.dispose();
    this.normalRenderTarget.depthTexture = null;
    this.normalRenderTarget.depthBuffer = false;
    this.gtaoMaterial.needsUpdate = this.pdMaterial.needsUpdate = true;
    this.blendIntensity = 0.48;
    this.updateGtaoMaterial({ radius: 0.65, thickness: 0.18, distanceFallOff: 1.5, samples: 16 });
    this.updatePdMaterial({ radius: 4, depthPhi: 2, normalPhi: 3, samples: 16 });
    this.composite = new THREE.ShaderMaterial({
      uniforms: { tScene: { value: null }, tAO: { value: this.pdRenderTarget.texture }, intensity: { value: 0 } },
      vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
      fragmentShader: `varying vec2 vUv;uniform sampler2D tScene,tAO;uniform float intensity;
        void main(){vec4 scene=texture2D(tScene,vUv),ao=texture2D(tAO,vUv);
        gl_FragColor=vec4(scene.rgb*mix(vec3(1.),ao.rgb,intensity),scene.a*ao.a);}`,
      depthTest: false, depthWrite: false, toneMapped: false,
    });
    this.compositeQuad = new FullScreenQuad(this.composite);
  }
  setSize(width, height) { super.setSize(Math.max(1, Math.round(width / 2)), Math.max(1, Math.round(height / 2))); }
  render(renderer, writeBuffer, readBuffer) {
    const output = this.output;
    this.output = GTAOPass.OUTPUT.Off;
    try { super.render(renderer, writeBuffer, readBuffer); }
    finally { this.output = output; }
    this.composite.uniforms.tScene.value = readBuffer.texture;
    this.composite.uniforms.intensity.value = this.blendIntensity;
    const autoClear = renderer.autoClear;
    try {
      renderer.autoClear = false;
      renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
      this.compositeQuad.render(renderer);
    } finally { renderer.autoClear = autoClear; }
  }
  dispose() {
    super.dispose();
    // These two materials are not released by the r180 base implementation.
    this.gtaoMaterial.dispose(); this.blendMaterial.dispose();
    this.composite.dispose(); this.compositeQuad.dispose();
  }
}
