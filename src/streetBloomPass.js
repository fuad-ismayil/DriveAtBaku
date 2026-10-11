import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

// The same r180 bright extraction, five blur levels and weighted composite.
// Leave the completed bloom in its existing texture; the grading draw adds it
// to beauty. Avoid a full-resolution additive write before that grading read.
export class StreetBloomPass extends UnrealBloomPass {
  setSize(width, height) { super.setSize(Math.max(1, width / 2), Math.max(1, height / 2)); }
  draw(renderer, target, material) {
    this._fsQuad.material = material;
    renderer.setRenderTarget(target); renderer.clear(); this._fsQuad.render(renderer);
  }
  render(renderer, writeBuffer, readBuffer) {
    renderer.getClearColor(this._oldClearColor);
    const alpha = renderer.getClearAlpha(), autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setClearColor(this.clearColor, 0);
    try {
      this.highPassUniforms.tDiffuse.value = readBuffer.texture;
      this.highPassUniforms.luminosityThreshold.value = this.threshold;
      this.draw(renderer, this.renderTargetBright, this.materialHighPassFilter);
      let input = this.renderTargetBright;
      for (let i = 0; i < this.nMips; i++) {
        const material = this.separableBlurMaterials[i];
        material.uniforms.colorTexture.value = input.texture;
        material.uniforms.direction.value = UnrealBloomPass.BlurDirectionX;
        this.draw(renderer, this.renderTargetsHorizontal[i], material);
        material.uniforms.colorTexture.value = this.renderTargetsHorizontal[i].texture;
        material.uniforms.direction.value = UnrealBloomPass.BlurDirectionY;
        this.draw(renderer, this.renderTargetsVertical[i], material);
        input = this.renderTargetsVertical[i];
      }
      this.compositeMaterial.uniforms.bloomStrength.value = this.strength;
      this.compositeMaterial.uniforms.bloomRadius.value = this.radius;
      this.compositeMaterial.uniforms.bloomTintColors.value = this.bloomTintColors;
      this.draw(renderer, this.renderTargetsHorizontal[0], this.compositeMaterial);
    } finally { renderer.setClearColor(this._oldClearColor, alpha); renderer.autoClear = autoClear; }
  }
}
