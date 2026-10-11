import * as THREE from 'three';
import { createVehicleWater } from './vehicleWater.js';

export const WEATHER_PRESETS = Object.freeze({
  sunny: { label: 'Sunny', clouds: 0, wet: 0, snow: 0, sun: 1, fog: 0.00014, fogColor: 0xb7c9d3 },
  overcast: { label: 'Overcast', clouds: 0.94, wet: 0, snow: 0, sun: 0.16, fog: 0.00055, fogColor: 0xaab7c3 },
  wet: { label: 'Wet roads', clouds: 0.55, wet: 1, snow: 0, sun: 0.55, fog: 0.00030, fogColor: 0xaabcca },
  rain: { label: 'Rain', clouds: 0.97, wet: 1, snow: 0, sun: 0.09, fog: 0.00085, fogColor: 0x9baabb },
  snow: { label: 'Snow', clouds: 0.97, wet: 0.25, snow: 0.9, sun: 0.12, fog: 0.00105, fogColor: 0xc1cbd4 },
});

export function createWeather(scene, sky, reflections) {
  const vehicleWater = createVehicleWater();
  const wetness = { value: 0 }, snowCover = { value: 0 };
  const center = { value: new THREE.Vector3() }, time = { value: 0 };
  const rainfall = { value: 0 };
  let mode = 'sunny', quality = 'cinematic', intensity = 1;
  let seed = 7813;
  const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 0xffffffff; };
  const particleShader = snow => new THREE.ShaderMaterial({
    uniforms: { weatherCenter: center, weatherTime: time, night: sky.material.uniforms.night },
    transparent: true, depthWrite: false, toneMapped: true,
    side: THREE.DoubleSide,
    vertexShader: `uniform vec3 weatherCenter; uniform float weatherTime; attribute float tail; attribute float edge;
      varying float vFade; varying vec2 vDropUv;
      void main() {
        vec3 p = position;
        // Wrap a world-anchored volume around the camera, so drops don't move
        // with the car. Z is vertical in the Baku map.
        p.z = mod(p.z - weatherTime * ${snow ? '1.6' : '25.0'} - weatherCenter.z + 8.0, 32.0) - 8.0;
        ${snow ? 'p.xy += vec2(sin(weatherTime*.7+position.z),cos(weatherTime*.5+position.x))*.7;' : 'p.xy += vec2(weatherTime*2.2,weatherTime*.55);'}
        p.xy = mod(p.xy - weatherCenter.xy + 32.0, 64.0) - 32.0;
        vFade = (1.0-smoothstep(24.0,32.0,length(p.xy))) * (1.0-smoothstep(20.0,24.0,p.z));
        p += weatherCenter;
        ${snow ? '' : `float dropLength = mix(.42,.85,fract(position.x*.173+position.y*.319));
          p += vec3(-.088,-.022,1.0) * tail * dropLength;
          vec3 cameraRight = vec3(viewMatrix[0][0],viewMatrix[1][0],viewMatrix[2][0]);
          p += cameraRight * edge * .014;
          vDropUv = vec2(edge,tail);`}
        vec4 view = viewMatrix * vec4(p, 1.0);
        vFade *= smoothstep(1.2,3.5,-view.z)*(1.0-smoothstep(38.0,58.0,-view.z));
        gl_Position = projectionMatrix * view;
        ${snow ? 'gl_PointSize = clamp(95.0/max(-view.z,1.0),1.2,5.0);' : ''}
      }`,
    fragmentShader: `uniform float night; varying float vFade; varying vec2 vDropUv; void main() {
      float opacity = ${snow ? '(1.0-smoothstep(.1,.5,length(gl_PointCoord-.5)))*.72' : '(1.0-smoothstep(.15,1.0,abs(vDropUv.x))) * sin(vDropUv.y*3.14159265) * .38'} * vFade;
      if(opacity < .01) discard;
      gl_FragColor = vec4(mix(vec3(.75,.84,.94),vec3(.38,.48,.62),night),opacity);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
  });
  function particles(snow) {
    // Reserve the 200% setting once; sliders only change the draw range.
    const count = snow ? 2400 : 3200, vertices = snow ? count : count * 6;
    const positions = new Float32Array(vertices * 3), tails = new Float32Array(vertices), edges = new Float32Array(vertices);
    const corners = [[-1,0],[1,0],[-1,1],[-1,1],[1,0],[1,1]];
    for (let i = 0; i < count; i++) {
      const x = (random() - 0.5) * 64, y = (random() - 0.5) * 64, z = random() * 32;
      for (let end = 0; end < (snow ? 1 : 6); end++) {
        const vertex = snow ? i : i * 6 + end;
        positions.set([x, y, z], vertex * 3);
        tails[vertex] = snow ? 0 : corners[end][1]; edges[vertex] = snow ? 0 : corners[end][0];
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('tail', new THREE.BufferAttribute(tails, 1));
    geometry.setAttribute('edge', new THREE.BufferAttribute(edges, 1));
    const object = snow ? new THREE.Points(geometry, particleShader(true)) : new THREE.Mesh(geometry, particleShader(false));
    object.name = snow ? 'weather snow' : 'weather rain';
    object.frustumCulled = false; object.visible = false; object.renderOrder = 1;
    object.userData.excludeFromReflection = true;
    scene.add(object); return object;
  }
  const rain = particles(false), snow = particles(true);

  function apply(material) {
    if ((!material.isMeshStandardMaterial && !material.isMeshPhysicalMaterial) || material.transparent || material.userData.weatherSurface) return false;
    material.userData.weatherSurface = true;
    const previous = material.onBeforeCompile, key = material.customProgramCacheKey();
    const isRoadSurface = Boolean(material.userData.dryRoadSurface);
    if (isRoadSurface) reflections?.registerRoad(material);
    material.onBeforeCompile = (shader, renderer) => {
      previous.call(material, shader, renderer);
      shader.uniforms.weatherWetness = wetness; shader.uniforms.weatherSnow = snowCover;
      shader.uniforms.weatherTime = time; shader.uniforms.weatherRainfall = rainfall;
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
          varying vec3 vWeatherPosition; uniform float weatherWetness, weatherSnow, weatherTime, weatherRainfall;
          float weatherNoise(vec2 p) {
            vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
            vec4 h=fract(sin(vec4(dot(i,vec2(127.1,311.7)),dot(i+vec2(1,0),vec2(127.1,311.7)),
              dot(i+vec2(0,1),vec2(127.1,311.7)),dot(i+1.0,vec2(127.1,311.7))))*43758.5453);
            return mix(mix(h.x,h.y,f.x),mix(h.z,h.w,f.x),f.y);
          }
          ${isRoadSurface ? `// A shallow depression field in world metres, shared across road chunks.
          // Small basins collect water; sloping road faces drain instead.
          float weatherDepression(vec2 p) {
            return weatherNoise(p*.46)*.64 + weatherNoise(p*1.35+vec2(13.7,4.1))*.26
              + weatherNoise(p*3.8)*.10;
          }
          vec2 weatherRipple(vec2 p) {
            vec2 cell=floor(p*1.4), offset=fract(p*1.4)-.5;
            float phase=fract(weatherTime*1.7+weatherNoise(cell+17.0)*7.0);
            float radius=length(offset);
            float ring=exp(-pow((radius-phase*.48)*36.0,2.0))*(1.0-phase);
            return offset/max(radius,.01)*ring*.028;
          }` : ''}`)
        // Run AFTER every normal/detail patch, immediately before PBR lighting.
        // Inserting at normal_fragment_maps lets the dry asphalt clamp overwrite
        // the water roughness and reintroduce grain into the puddles.
        .replace('#include <lights_physical_fragment>', `
          float weatherPool=0.0;
          ${isRoadSurface ? `// Richer neutral charcoal in dry weather. Preserve bright atlas
          // markings and leave the established wet-road colour untouched.
          if (weatherWetness < 1.0) {
            float dryRoadLuma = dot(diffuseColor.rgb, vec3(.2126,.7152,.0722));
            float dryAggregate = 1.0-smoothstep(.18,.42,dryRoadLuma);
            float dryVariation = mix(.83,.91,weatherNoise(vWeatherPosition.xy*.075));
            vec3 dryCharcoal = mix(vec3(dryRoadLuma),diffuseColor.rgb,.88)*vec3(1.02,1.0,.97)*dryVariation;
            diffuseColor.rgb = mix(diffuseColor.rgb,dryCharcoal,dryAggregate*(1.0-weatherWetness));
          }` : ''}
          if (weatherWetness > 0.0 || weatherSnow > 0.0) {
          float weatherTop=smoothstep(.45,.92,dot(normal,mat3(viewMatrix)*vec3(0,0,1)));
          float wetSurface=weatherWetness*mix(.12,1.0,weatherTop);
          float puddle=0.0;
          ${isRoadSurface ? `vec3 roadUp=normalize(mat3(viewMatrix)*vec3(0,0,1));
          float drainage=1.0-smoothstep(.035,.14,length(cross(nonPerturbedNormal,roadUp)));
          float depression=weatherDepression(vWeatherPosition.xy);
          float poolWidth=max(fwidth(depression),.018);
          float basin=1.0-smoothstep(.25-poolWidth,.36+poolWidth,depression);
          float smallPocket=1.0-smoothstep(.18,.28,weatherNoise(vWeatherPosition.xy*3.8+7.1));
          puddle=max(basin,smallPocket*.16)*drainage*weatherTop*weatherWetness*(1.0-step(.001,weatherSnow));
          weatherPool=puddle;
          // Only falling rain disturbs pooled water. The no-rain preset is still.
          vec2 ripple=vec2(0.0);
          if(weatherRainfall>0.0 && puddle>.05) ripple=weatherRipple(vWeatherPosition.xy)*min(weatherRainfall,1.0);
          vec3 waterNormal=normalize(mat3(viewMatrix)*vec3(ripple,1.0));
          normal=normalize(mix(normal,waterNormal,puddle*.94));` : ''}
          diffuseColor.rgb *= mix(1.0,mix(.60,.48,puddle),wetSurface);
          roughnessFactor=mix(roughnessFactor,mix(.30,.12,puddle),wetSurface);
          float settledSnow=0.0;
          if(weatherSnow>0.0) settledSnow=weatherSnow*weatherTop*mix(.78,1.0,weatherNoise(vWeatherPosition.xy*.9));
          diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.84,.88,.92),settledSnow);
          roughnessFactor=mix(roughnessFactor,.96,settledSnow);
          normal=normalize(mix(normal,normalize(mat3(viewMatrix)*vec3(0,0,1)),settledSnow*.25));
          metalnessFactor *= 1.0-settledSnow;
          }
          #include <lights_physical_fragment>
          // Water is a dielectric (IOR 1.333), with less normal-incidence
          // reflectance than bare asphalt and stronger reflections at grazing angles.
          ${isRoadSurface ? 'material.specularColor=mix(material.specularColor,vec3(.02037),weatherPool);' : ''}
        `);
      if (material.userData.dryRoadSurface) shader.fragmentShader = shader.fragmentShader
        .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
          // Porous dry aggregate has a restrained sheen; water restores its specular response.
          float roadSheen=mix(.28,1.0,weatherWetness);
          reflectedLight.directSpecular *= roadSheen;
          reflectedLight.indirectSpecular *= roadSheen;
        `);
    };
    material.customProgramCacheKey = () => `${key}:weather-surface-v5:${isRoadSurface ? 'road-puddles' : 'surface'}`;
    material.needsUpdate = true; return true;
  }
  function setMode(value) {
    mode = Object.hasOwn(WEATHER_PRESETS, value) ? value : 'sunny';
    const preset = WEATHER_PRESETS[mode];
    wetness.value = preset.wet; snowCover.value = preset.snow;
    rainfall.value = mode === 'rain' ? intensity : 0;
    reflections?.setWetRoads(mode === 'rain' || mode === 'wet');
    sky.material.uniforms.cloudCover.value = preset.clouds;
    return mode;
  }
  function setQuality(value) {
    quality = value;
    vehicleWater.setQuality(value);
    updateDensity();
  }
  function updateDensity() {
    const density = quality === 'performance' ? 0.35 : quality === 'balanced' ? 0.65 : 1;
    rain.geometry.setDrawRange(0, Math.floor(1600 * density * intensity) * 6);
    snow.geometry.setDrawRange(0, Math.floor(1200 * density * intensity));
  }
  function setIntensity(value) {
    const number = Number(value);
    intensity = Number.isFinite(number) ? THREE.MathUtils.clamp(number, 0, 2) : 1;
    rainfall.value = mode === 'rain' ? intensity : 0;
    updateDensity();
    return intensity;
  }
  setQuality(quality);
  return {
    apply, setMode, setQuality, setIntensity,
    updateVehicle(vehicle, dt, velocity, outside = true) {
      return vehicleWater.updateVehicle(vehicle, dt, {
        rain: rainfall.value, outside, velocity, sunny: mode === 'sunny',
      });
    },
    getVehicleWetness: vehicleWater.getWetness,
    get intensity() { return intensity; },
    get mode() { return mode; }, get preset() { return WEATHER_PRESETS[mode]; },
    update(dt, camera, outside = true) {
      time.value += dt; center.value.copy(camera.position);
      vehicleWater.update(dt);
      rain.visible = outside && mode === 'rain' && intensity > 0; snow.visible = outside && mode === 'snow' && intensity > 0;
    },
    dispose() { for (const object of [rain, snow]) { object.removeFromParent(); object.geometry.dispose(); object.material.dispose(); } },
  };
}
