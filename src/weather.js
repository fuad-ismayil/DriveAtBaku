import * as THREE from 'three';

export const WEATHER_PRESETS = Object.freeze({
  sunny: { label: 'Sunny', clouds: 0, wet: 0, snow: 0, sun: 1, fog: 0.00014, fogColor: 0xb7c9d3 },
  overcast: { label: 'Overcast', clouds: 0.94, wet: 0, snow: 0, sun: 0.16, fog: 0.00055, fogColor: 0xaab7c3 },
  wet: { label: 'Wet roads', clouds: 0.55, wet: 1, snow: 0, sun: 0.55, fog: 0.00030, fogColor: 0xaabcca },
  rain: { label: 'Rain', clouds: 0.97, wet: 1, snow: 0, sun: 0.09, fog: 0.00085, fogColor: 0x9baabb },
  snow: { label: 'Snow', clouds: 0.97, wet: 0.25, snow: 0.9, sun: 0.12, fog: 0.00105, fogColor: 0xc1cbd4 },
});

export function createWeather(scene, sky) {
  const wetness = { value: 0 }, snowCover = { value: 0 };
  const center = { value: new THREE.Vector3() }, time = { value: 0 };
  let mode = 'sunny', quality = 'cinematic', intensity = 1;
  let seed = 7813;
  const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 0xffffffff; };
  const particleShader = snow => new THREE.ShaderMaterial({
    uniforms: { weatherCenter: center, weatherTime: time, night: sky.material.uniforms.night },
    transparent: true, depthWrite: false, toneMapped: true,
    vertexShader: `uniform vec3 weatherCenter; uniform float weatherTime; attribute float tail; varying float vFade;
      void main() {
        vec3 p = position;
        p.z = mod(p.z - weatherTime * ${snow ? '1.6' : '25.0'}, 32.0) - 3.0;
        ${snow ? 'p.xy += vec2(sin(weatherTime*.7+position.z),cos(weatherTime*.5+position.x))*.7;' : 'p.xy += vec2(p.z*.10,p.z*.025); p.z += tail * .75;'}
        vFade = smoothstep(-2.0, 0.0, p.z) * (1.0-smoothstep(23.0,29.0,p.z));
        vec4 view = viewMatrix * vec4(p + weatherCenter, 1.0);
        gl_Position = projectionMatrix * view;
        ${snow ? 'gl_PointSize = clamp(95.0/max(-view.z,1.0),1.2,5.0);' : ''}
      }`,
    fragmentShader: `uniform float night; varying float vFade; void main() {
      float opacity = ${snow ? '(1.0-smoothstep(.1,.5,length(gl_PointCoord-.5)))*.72' : '.22'} * vFade;
      if(opacity < .01) discard;
      gl_FragColor = vec4(mix(vec3(.75,.84,.94),vec3(.24,.34,.49),night),opacity);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
  });
  function particles(snow) {
    // Reserve the 200% setting once; sliders only change the draw range.
    const count = snow ? 2400 : 3200, vertices = snow ? count : count * 2;
    const positions = new Float32Array(vertices * 3), tails = new Float32Array(vertices);
    for (let i = 0; i < count; i++) {
      const x = (random() - 0.5) * 64, y = (random() - 0.5) * 64, z = random() * 32;
      for (let end = 0; end < (snow ? 1 : 2); end++) {
        const vertex = snow ? i : i * 2 + end;
        positions.set([x, y, z], vertex * 3); tails[vertex] = end;
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('tail', new THREE.BufferAttribute(tails, 1));
    const object = snow ? new THREE.Points(geometry, particleShader(true)) : new THREE.LineSegments(geometry, particleShader(false));
    object.name = snow ? 'weather snow' : 'weather rain';
    object.frustumCulled = false; object.visible = false; object.renderOrder = 1;
    scene.add(object); return object;
  }
  const rain = particles(false), snow = particles(true);

  function apply(material) {
    if ((!material.isMeshStandardMaterial && !material.isMeshPhysicalMaterial) || material.transparent || material.userData.weatherSurface) return false;
    material.userData.weatherSurface = true;
    const previous = material.onBeforeCompile, key = material.customProgramCacheKey();
    material.onBeforeCompile = (shader, renderer) => {
      previous.call(material, shader, renderer);
      shader.uniforms.weatherWetness = wetness; shader.uniforms.weatherSnow = snowCover;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWeatherPosition;')
        .replace('#include <project_vertex>', `#include <project_vertex>
          vec4 weatherWorld = vec4(transformed, 1.0);
          #ifdef USE_BATCHING
            weatherWorld = batchingMatrix * weatherWorld;
          #endif
          #ifdef USE_INSTANCING
            weatherWorld = instanceMatrix * weatherWorld;
          #endif
          vWeatherPosition = (modelMatrix * weatherWorld).xyz;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec3 vWeatherPosition; uniform float weatherWetness, weatherSnow;
          float weatherNoise(vec2 p) {
            vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
            vec4 h=fract(sin(vec4(dot(i,vec2(127.1,311.7)),dot(i+vec2(1,0),vec2(127.1,311.7)),
              dot(i+vec2(0,1),vec2(127.1,311.7)),dot(i+1.0,vec2(127.1,311.7))))*43758.5453);
            return mix(mix(h.x,h.y,f.x),mix(h.z,h.w,f.x),f.y);
          }`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
          if (weatherWetness > 0.0 || weatherSnow > 0.0) {
          float weatherTop=smoothstep(.45,.92,dot(normal,mat3(viewMatrix)*vec3(0,0,1)));
          float weatherPatch=weatherNoise(vWeatherPosition.xy*.34);
          float wetSurface=weatherWetness*mix(.12,1.0,weatherTop);
          float puddle=smoothstep(.56,.78,weatherPatch)*weatherTop*weatherWetness;
          diffuseColor.rgb *= mix(1.0,.68,wetSurface);
          roughnessFactor=mix(roughnessFactor,mix(.34,.14,puddle),wetSurface);
          normal=normalize(mix(normal,normalize(mat3(viewMatrix)*vec3(0,0,1)),puddle*.5));
          float settledSnow=0.0;
          if(weatherSnow>0.0) settledSnow=weatherSnow*weatherTop*mix(.78,1.0,weatherNoise(vWeatherPosition.xy*.9));
          diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.84,.88,.92),settledSnow);
          roughnessFactor=mix(roughnessFactor,.96,settledSnow);
          normal=normalize(mix(normal,normalize(mat3(viewMatrix)*vec3(0,0,1)),settledSnow*.25));
          metalnessFactor *= 1.0-settledSnow;
          }
        `);
      if (material.userData.dryRoadSurface) shader.fragmentShader = shader.fragmentShader
        .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
          // Porous dry aggregate has a restrained sheen; water restores its specular response.
          float roadSheen=mix(.28,1.0,weatherWetness);
          reflectedLight.directSpecular *= roadSheen;
          reflectedLight.indirectSpecular *= roadSheen;
        `);
    };
    material.customProgramCacheKey = () => `${key}:weather-surface-v2`;
    material.needsUpdate = true; return true;
  }
  function setMode(value) {
    mode = Object.hasOwn(WEATHER_PRESETS, value) ? value : 'sunny';
    const preset = WEATHER_PRESETS[mode];
    wetness.value = preset.wet; snowCover.value = preset.snow;
    sky.material.uniforms.cloudCover.value = preset.clouds;
    return mode;
  }
  function setQuality(value) {
    quality = value;
    updateDensity();
  }
  function updateDensity() {
    const density = quality === 'performance' ? 0.35 : quality === 'balanced' ? 0.65 : 1;
    rain.geometry.setDrawRange(0, Math.floor(1600 * density * intensity) * 2);
    snow.geometry.setDrawRange(0, Math.floor(1200 * density * intensity));
  }
  function setIntensity(value) {
    const number = Number(value);
    intensity = Number.isFinite(number) ? THREE.MathUtils.clamp(number, 0, 2) : 1;
    updateDensity();
    return intensity;
  }
  setQuality(quality);
  return {
    apply, setMode, setQuality, setIntensity,
    get intensity() { return intensity; },
    get mode() { return mode; }, get preset() { return WEATHER_PRESETS[mode]; },
    update(dt, camera, outside = true) {
      time.value += dt; center.value.copy(camera.position);
      rain.visible = outside && mode === 'rain' && intensity > 0; snow.visible = outside && mode === 'snow' && intensity > 0;
    },
    dispose() { for (const object of [rain, snow]) { object.removeFromParent(); object.geometry.dispose(); object.material.dispose(); } },
  };
}
