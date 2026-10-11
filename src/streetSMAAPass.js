import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { Color, RGFormat, UnsignedByteType } from 'three';

// SMAA still detects edges and blends in linear HDR. Apply the renderer's
// normal tone mapping/output conversion AFTER the final neighbourhood blend,
// in the same fragment. This removes the intermediate HDR write/read + copy.
// Keep the r180 SMAA kernels, lookup textures and sample counts unchanged.
export class StreetSMAAPass extends SMAAPass {
  constructor() {
    super();
    // Edge detection writes only binary R/G flags. RG8 stores these exactly;
    // HDR colour and floating-point blending weights keep their original types.
    this._edgesRT.texture.format = RGFormat;
    this._edgesRT.texture.type = UnsignedByteType;
    this.clearColor = new Color();
    this._materialBlend.fragmentShader = this._materialBlend.fragmentShader
      .replace(/void main\s*\(\s*\)/, 'void smaaBlend()') + `
      void main() {
        smaaBlend();
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`;
    this._materialBlend.depthTest = false;
    this._materialBlend.depthWrite = false;
  }
  render(renderer, ...args) {
    renderer.getClearColor(this.clearColor);
    const alpha = renderer.getClearAlpha(), autoClear = renderer.autoClear;
    // The edge shader discards non-edges. Blue scene clears used to leave false
    // edges in those pixels, making the weight shader search empty sky/roads.
    renderer.setClearColor(0, 0);
    renderer.autoClear = true;
    try { super.render(renderer, ...args); }
    finally { renderer.setClearColor(this.clearColor, alpha); renderer.autoClear = autoClear; }
  }
}
