import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { StreetBloomPass } from './streetBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { StreetSMAAPass } from './streetSMAAPass.js';
import { StreetScenePass, StreetAOPass } from './streetAOPass.js';
import { normalizeRenderingResolution, renderingSize } from './renderingResolution.js';

const PRESETS = {
  performance: { pixelRatio: 1, shadows: 1024, bloom: false },
  balanced: { pixelRatio: 1.5, shadows: 2048, bloom: true },
  cinematic: { pixelRatio: 2, shadows: 4096, bloom: true },
};

class StreetComposer extends EffectComposer {
  render(dt) {
    const target = this.renderer.getRenderTarget();
    try {
      this.passes[0].render(this.renderer);
      let input = this.passes[0].target, output = this.renderTarget1;
      for (let i = 1; i < this.passes.length; i++) {
        const pass = this.passes[i];
        if (!pass.enabled) continue;
        pass.renderToScreen = this.renderToScreen && this.isLastEnabledPass(i);
        pass.render(this.renderer, output, input, dt, false);
        if (pass.needsSwap) {
          input = output;
          output = output === this.renderTarget1 ? this.renderTarget2 : this.renderTarget1;
        }
      }
    } finally { this.renderer.setRenderTarget(target); }
  }
}

export function createGraphics(renderer, scene, camera, sun) {
  const hdrSupported = renderer.extensions.has('EXT_color_buffer_float');
  let composer, bloom, grade, smaa, scenePass, ao, quality = 'balanced';
  let renderScale = 1, aoWanted = true, renderingResolution = 'native';
  const drawingSize = new THREE.Vector2();
  let viewportWidth, viewportHeight;
  let appliedQuality = null;
  let night = false;
  const gl = renderer.getContext();
  const colorSamples = hdrSupported ? Array.from(gl.getInternalformatParameter(gl.RENDERBUFFER, gl.RGBA16F, gl.SAMPLES)) : [];
  const depthSamples = Array.from(gl.getInternalformatParameter(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, gl.SAMPLES));
  const supportedSamples = colorSamples.filter(samples => depthSamples.includes(samples));
  const sampleCount = maximum => Math.max(0, ...supportedSamples.filter(samples => samples <= maximum));

  function createComposer() {
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    composer = new StreetComposer(renderer, target);
    composer.setPixelRatio(1);
    scenePass = new StreetScenePass(scene, camera, sampleCount(quality === 'cinematic' ? 4 : 2));
    composer.addPass(scenePass);
    ao = new StreetAOPass(scene, camera, scenePass.target.depthTexture);
    composer.addPass(ao);
    bloom = new StreetBloomPass(new THREE.Vector2(1, 1), 0.16, 0.35, 1.35);
    composer.addPass(bloom);
    grade = new ShaderPass({
      uniforms: { tDiffuse: { value: null }, tBloom: { value: bloom.renderTargetsHorizontal[0].texture }, night: { value: 0 } },
      vertexShader: `varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform sampler2D tDiffuse, tBloom; uniform float night; varying vec2 vUv;
        void main() {
          vec4 source = texture2D(tDiffuse, vUv);
          source += texture2D(tBloom, vUv);
          vec3 color = source.rgb;
          float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
          color = mix(vec3(luminance), color, mix(1.04, 1.02, night));
          vec2 lens = (vUv - 0.5) * 1.25;
          float falloff = smoothstep(0.22, 0.72, dot(lens, lens));
          color *= 1.0 - falloff * 0.10;
          gl_FragColor = vec4(max(color, vec3(0.0)), source.a);
        }`,
    });
    composer.addPass(grade);
    smaa = new StreetSMAAPass();
    composer.addPass(smaa);
    // SMAA's final blend converts and tone-maps exactly once, on screen.
  }

  function resize(width = innerWidth, height = innerHeight) {
    viewportWidth = width; viewportHeight = height;
    const size = renderingSize(width, height, devicePixelRatio, PRESETS[quality].pixelRatio, renderScale, renderingResolution);
    // One drawing-buffer resize, keeping logical renderer size and DOM/pointer
    // coordinates in CSS pixels. Menus/HUD retain their normal DOM resolution.
    renderer.setDrawingBufferSize(size.width, size.height, size.pixelRatio);
    renderer.domElement.style.width = `${size.width}px`;
    renderer.domElement.style.height = `${size.height}px`;
    renderer.getDrawingBufferSize(drawingSize);
    if (composer) {
      // Composer dimensions are physical pixels. Avoid applying DPR twice and
      // avoid an intermediate resize of every target at the old viewport size.
      composer.setSize(drawingSize.x, drawingSize.y);
    }
  }

  function setNight(enabled) {
    night = Boolean(enabled);
    if (bloom) {
      bloom.strength = night ? 0.30 : 0.16;
      bloom.threshold = night ? 0.95 : 1.35;
      grade.uniforms.night.value = night ? 1 : 0;
    }
  }

  function setQuality(value) {
    const next = Object.hasOwn(PRESETS, value) ? value : 'balanced';
    if (appliedQuality === next) return quality;
    appliedQuality = next;
    if (next !== quality && composer) {
      for (const pass of composer.passes) pass.dispose();
      composer.dispose();
      composer = bloom = grade = smaa = scenePass = ao = null;
    }
    quality = next;
    const preset = PRESETS[quality];
    if (!preset.bloom && composer) {
      for (const pass of composer.passes) pass.dispose();
      composer.dispose();
      composer = bloom = grade = smaa = scenePass = ao = null;
    }
    if (preset.bloom && hdrSupported && !composer) createComposer();
    if (composer) {
      ao.enabled = aoWanted;
      ao.blendIntensity = quality === 'cinematic' ? 0.48 : 0.38;
      ao.updateGtaoMaterial({ samples: quality === 'cinematic' ? 16 : 8 });
    }
    sun.shadow.mapSize.set(preset.shadows, preset.shadows);
    sun.shadow.map?.dispose();
    sun.shadow.map = null;
    sun.shadow.needsUpdate = true;
    resize();
    setNight(night);
    return quality;
  }

  return {
    setQuality, setNight, resize,
    async warmup() {
      const target = renderer.getRenderTarget(), face = renderer.getActiveCubeFace(), mip = renderer.getActiveMipmapLevel();
      const temporaryHDR = !scenePass && hdrSupported
        ? new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false }) : null;
      try {
        // Program keys depend on target color space / tone mapping. Compiling
        // only for the canvas does not prepare the HDR beauty variants.
        if (scenePass || temporaryHDR) {
          renderer.setRenderTarget(scenePass?.target ?? temporaryHDR);
          await renderer.compileAsync(scene, camera);
        }
        // Also prepare the direct Performance path before a later preset edit.
        renderer.setRenderTarget(null);
        await renderer.compileAsync(scene, camera);
      } finally { renderer.setRenderTarget(target, face, mip); temporaryHDR?.dispose(); }
      // Also allocate the real targets and geometry buffers while loading.
      try { if (composer) composer.render(0); else renderer.render(scene, camera); }
      finally { renderer.setRenderTarget(target, face, mip); }
    },
    setRenderingResolution(value) { renderingResolution = normalizeRenderingResolution(value); resize(viewportWidth, viewportHeight); return renderingResolution; },
    setAO(enabled) { aoWanted = Boolean(enabled); if (ao) ao.enabled = aoWanted; },
    setRenderScale(value) { renderScale = [1, 1.25, 1.5].includes(Number(value)) ? Number(value) : 1; resize(); return renderScale; },
    get aoAvailable() { return Boolean(ao); },
    get stats() { renderer.getDrawingBufferSize(drawingSize); return { samples: scenePass?.target.samples ?? 0, ao: Boolean(ao?.enabled), aoSize: ao ? [ao.width, ao.height] : [0, 0], renderScale, pixelRatio: renderer.getPixelRatio(), renderingResolution, drawingBuffer: [drawingSize.x, drawingSize.y] }; },
    get quality() { return quality; },
    render(dt) {
      if (composer && PRESETS[quality].bloom && hdrSupported) composer.render(dt);
      else renderer.render(scene, camera);
    },
  };
}

export function createSkyEnvironments(renderer, sky) {
  const generator = new THREE.PMREMGenerator(renderer);
  const capture = new THREE.Scene();
  const dome = new THREE.Mesh(sky.geometry, sky.material);
  dome.frustumCulled = false;
  capture.add(dome);
  const cache = new Map();
  function get(nightMode, clouds = 0) {
    // Three cloud levels shared by all modes; generate on first use, then reuse.
    const level = clouds < .2 ? 0 : clouds < .75 ? .55 : .97;
    const key = `${nightMode}:${level}`;
    if (!cache.has(key)) {
      const savedNight = sky.material.uniforms.night.value, savedClouds = sky.material.uniforms.cloudCover.value;
      try {
        sky.material.uniforms.night.value = nightMode ? 1 : 0;
        sky.material.uniforms.cloudCover.value = level;
        cache.set(key, generator.fromScene(capture, 0.025, 0.1, 6000));
      } finally { sky.material.uniforms.night.value = savedNight; sky.material.uniforms.cloudCover.value = savedClouds; }
    }
    return cache.get(key);
  }
  return { day: get(false), night: get(true), get,
    dispose() { for (const target of cache.values()) target.dispose(); generator.dispose(); } };
}
