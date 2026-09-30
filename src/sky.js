import * as THREE from 'three';

export function createSky() {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      night: { value: 0 },
      time: { value: 0 },
      sunDirection: { value: new THREE.Vector3(0.90, 0.33, 0.29).normalize() },
      moonDirection: { value: new THREE.Vector3(0.38, 0.52, 0.76).normalize() },
    },
    vertexShader: `
      varying vec3 vDirection;
      void main() {
        vDirection = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vDirection;
      uniform float night;
      uniform float time;
      uniform vec3 sunDirection;
      uniform vec3 moonDirection;
      float hash21(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }
      float noise21(vec2 p) {
        vec2 cell = floor(p);
        vec2 blend = fract(p);
        blend = blend * blend * (3.0 - 2.0 * blend);
        return mix(mix(hash21(cell), hash21(cell + vec2(1.0, 0.0)), blend.x),
                   mix(hash21(cell + vec2(0.0, 1.0)), hash21(cell + 1.0), blend.x), blend.y);
      }
      void main() {
        vec3 direction = normalize(vDirection);
        float altitude = max(direction.z, 0.0);
        vec3 day = mix(vec3(0.08, 0.38, 0.76), vec3(0.012, 0.22, 0.72), smoothstep(0.0, 0.58, altitude));
        day = mix(day, vec3(0.005, 0.105, 0.50), smoothstep(0.42, 1.0, altitude));
        vec3 afterDark = mix(vec3(0.09, 0.15, 0.25), vec3(0.008, 0.018, 0.052), altitude);
        float facingSun = max(dot(direction, normalize(sunDirection)), 0.0);
        float sunHalo = pow(facingSun, 95.0);
        float sunDisc = smoothstep(0.9995, 0.99986, facingSun);
        day += vec3(1.0, 0.82, 0.62) * sunHalo * 0.2;
        day += vec3(3.4, 3.15, 2.75) * sunDisc;
        float azimuth = atan(direction.y, direction.x);
        float drift = time * 0.002;
        float warp = (noise21(vec2(azimuth * 6.0 + drift, altitude * 20.0)) - 0.5) * 0.018;
        float lineA = altitude - 0.29 - 0.014 * sin(azimuth * 8.0 + drift) - warp;
        float lineB = altitude - 0.32 - 0.012 * sin(azimuth * 10.0 - drift) + warp;
        float lineC = altitude - 0.27 - 0.011 * sin(azimuth * 7.0 + drift) - warp;
        vec2 offsetA = vec2((azimuth - 0.28) / 0.52, lineA / 0.019);
        vec2 offsetB = vec2((azimuth - 0.72) / 0.34, lineB / 0.015);
        vec2 offsetC = vec2((azimuth + 0.80) / 0.40, lineC / 0.018);
        float streakA = exp(-dot(offsetA, offsetA));
        float streakB = exp(-dot(offsetB, offsetB));
        float streakC = exp(-dot(offsetC, offsetC));
        float cloud = min(1.0, streakA + streakB + streakC) * 0.36;
        day = mix(day, vec3(0.91, 0.95, 0.99), cloud);
        float moon = pow(max(dot(direction, normalize(moonDirection)), 0.0), 260.0);
        afterDark += vec3(0.42, 0.57, 0.85) * moon * 0.25;
        gl_FragColor = vec4(mix(day, afterDark, night), 1.0);
        #include <colorspace_fragment>
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(3500, 32, 16), material);
  sky.frustumCulled = false;
  sky.renderOrder = -100;
  return sky;
}
