import * as THREE from 'three';

export function createSky() {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      night: { value: 0 },
      time: { value: 0 },
      sunDirection: { value: new THREE.Vector3(450, 165, 310).normalize() },
      moonDirection: { value: new THREE.Vector3(270, 190, 590).normalize() },
    },
    vertexShader: `
      varying vec3 vDirection;
      void main() {
        vDirection = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vDirection;
      uniform float night, time;
      uniform vec3 sunDirection, moonDirection;
      float hash21(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }
      float noise21(vec2 p) {
        vec2 cell = floor(p), blend = fract(p);
        blend = blend * blend * (3.0 - 2.0 * blend);
        return mix(mix(hash21(cell), hash21(cell + vec2(1.0, 0.0)), blend.x),
                   mix(hash21(cell + vec2(0.0, 1.0)), hash21(cell + 1.0), blend.x), blend.y);
      }
      float cloudNoise(vec2 p) {
        return noise21(p) * 0.57 + noise21(p * 2.03 + 17.2) * 0.28
          + noise21(p * 4.07 + 31.7) * 0.15;
      }
      void main() {
        vec3 direction = normalize(vDirection);
        float altitude = max(direction.z, 0.0);
        float horizon = exp(-altitude * 7.0);
        vec3 day = mix(vec3(0.075, 0.24, 0.49), vec3(0.50, 0.66, 0.78), horizon);
        float facingSun = max(dot(direction, normalize(sunDirection)), 0.0);
        day += vec3(0.34, 0.18, 0.065) * pow(facingSun, 9.0) * (0.4 + horizon);
        day += vec3(1.0, 0.73, 0.40) * pow(facingSun, 180.0) * 0.24;
        float sunDisc = smoothstep(0.99994, 0.99997, facingSun);
        day += vec3(10.0, 8.4, 6.3) * sunDisc;

        // A high cloud layer, projected in the game's Z-up world.
        vec2 cloudUv = direction.xy / max(direction.z + 0.20, 0.08) * 2.7;
        cloudUv += vec2(time * 0.003, time * 0.001);
        float cloudField = cloudNoise(cloudUv);
        float cloud = smoothstep(0.56, 0.76, cloudField)
          * smoothstep(0.035, 0.22, altitude) * 0.72;
        vec3 cloudColor = mix(vec3(0.63, 0.69, 0.76), vec3(1.18, 1.08, 0.92),
          smoothstep(0.56, 0.80, cloudField));
        day = mix(day, cloudColor, cloud);
        day = mix(vec3(0.11, 0.105, 0.095), day, smoothstep(-0.16, 0.02, direction.z));

        vec3 afterDark = mix(vec3(0.004, 0.009, 0.026), vec3(0.040, 0.066, 0.105), horizon);
        float facingMoon = max(dot(direction, normalize(moonDirection)), 0.0);
        afterDark += vec3(0.10, 0.15, 0.25) * pow(facingMoon, 28.0);
        float moonDisc = smoothstep(0.99990, 0.99996, facingMoon);
        afterDark += vec3(2.1, 2.35, 2.7) * moonDisc;
        vec2 starUv = vec2(atan(direction.y, direction.x), asin(clamp(direction.z, -1.0, 1.0))) * 160.0;
        vec2 starCell = floor(starUv);
        float star = step(0.989, hash21(starCell))
          * (1.0 - smoothstep(0.045, 0.18, length(fract(starUv) - 0.5)));
        afterDark += vec3(0.65, 0.76, 0.95) * star * smoothstep(0.1, 0.35, altitude) * (1.0 - cloud);
        afterDark = mix(afterDark, vec3(0.055, 0.075, 0.11), cloud * 0.35);
        afterDark = mix(vec3(0.008, 0.012, 0.018), afterDark, smoothstep(-0.16, 0.02, direction.z));
        gl_FragColor = vec4(mix(day, afterDark, night), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(3500, 32, 16), material);
  sky.frustumCulled = false;
  sky.renderOrder = -100;
  return sky;
}
