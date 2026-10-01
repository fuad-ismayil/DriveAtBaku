import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';

const PRESETS = {
  performance: { pixelRatio: 1, shadows: 1024, bloom: false },
  balanced: { pixelRatio: 1.5, shadows: 2048, bloom: true },
  cinematic: { pixelRatio: 2, shadows: 4096, bloom: true },
};

// Bloom starts at quarter resolution; the detailed scene is rendered only once.
class SoftBloomPass extends UnrealBloomPass {
  setSize(width, height) { super.setSize(Math.max(1, width / 2), Math.max(1, height / 2)); }
}

export function createGraphics(renderer, scene, camera, sun) {
  const hdrSupported = renderer.extensions.has('EXT_color_buffer_float');
  let composer, bloom, grade, antialias, smaa, quality = 'balanced';
  let night = false;

  function createComposer() {
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
    composer = new EffectComposer(renderer, target);
    composer.addPass(new RenderPass(scene, camera));
    bloom = new SoftBloomPass(new THREE.Vector2(1, 1), 0.16, 0.35, 1.35);
    composer.addPass(bloom);
    grade = new ShaderPass({
      uniforms: { tDiffuse: { value: null }, night: { value: 0 } },
      vertexShader: `varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform sampler2D tDiffuse; uniform float night; varying vec2 vUv;
        void main() {
          vec4 source = texture2D(tDiffuse, vUv);
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
    smaa = new SMAAPass();
    composer.addPass(smaa);
    // Effects operate in linear HDR; convert and tone-map exactly once.
    composer.addPass(new OutputPass());
    // FXAA expects sRGB input and avoids driver-specific HDR/MSAA combinations.
    antialias = new ShaderPass(FXAAShader);
    composer.addPass(antialias);
  }

  function resize(width = innerWidth, height = innerHeight) {
    renderer.setPixelRatio(Math.min(devicePixelRatio, PRESETS[quality].pixelRatio));
    renderer.setSize(width, height);
    if (composer) {
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(width, height);
      antialias.uniforms.resolution.value.set(1 / (width * renderer.getPixelRatio()), 1 / (height * renderer.getPixelRatio()));
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
    quality = Object.hasOwn(PRESETS, value) ? value : 'balanced';
    const preset = PRESETS[quality];
    if (!preset.bloom && composer) {
      for (const pass of composer.passes) pass.dispose();
      composer.dispose();
      composer = bloom = grade = antialias = smaa = null;
    }
    if (preset.bloom && hdrSupported && !composer) createComposer();
    if (composer) {
      smaa.enabled = quality === 'cinematic';
      antialias.enabled = quality !== 'cinematic';
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
  const savedNight = sky.material.uniforms.night.value;
  sky.material.uniforms.night.value = 0;
  const day = generator.fromScene(capture, 0.025, 0.1, 6000);
  sky.material.uniforms.night.value = 1;
  const night = generator.fromScene(capture, 0.025, 0.1, 6000);
  sky.material.uniforms.night.value = savedNight;
  generator.dispose();
  return { day, night };
}
