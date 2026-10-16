// Generated from src/sky.js.
shader_type sky;


      uniform float night = 0.0; uniform float sky_time = 0.0; uniform float cloudCover = 0.0;
      uniform vec3 sunDirection = vec3(450,165,310); uniform vec3 moonDirection = vec3(270,190,590);
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
      void sky() {
        vec3 direction = normalize(vec3(EYEDIR.x,-EYEDIR.z,EYEDIR.y));
        float altitude = max(direction.z, 0.0);
        float horizon = exp(-altitude * 7.0);
        vec3 day = mix(vec3(0.075, 0.24, 0.49), vec3(0.50, 0.66, 0.78), horizon);
        float facingSun = max(dot(direction, normalize(sunDirection)), 0.0);
        day += vec3(0.22, 0.205, 0.185) * pow(facingSun, 9.0) * (0.4 + horizon) * (1.0-cloudCover);
        day += vec3(1.0, 0.97, 0.92) * pow(facingSun, 180.0) * 0.18 * (1.0-cloudCover);
        float sunDisc = smoothstep(0.99994, 0.99997, facingSun);
        day += vec3(10.0, 9.8, 9.4) * sunDisc * (1.0-cloudCover);

        // A high cloud layer, projected in the game's Z-up world.
        vec2 cloudUv = direction.xy / max(direction.z + 0.20, 0.08) * 2.7;
        cloudUv += vec2(sky_time * 0.003, sky_time * 0.001);
        float cloudField = cloudNoise(cloudUv);
        float cloud = smoothstep(mix(.56,.15,cloudCover), mix(.76,.52,cloudCover), cloudField)
          * smoothstep(0.035, 0.22, altitude) * mix(.72,1.0,cloudCover);
        vec3 cloudColor = mix(vec3(0.63, 0.69, 0.76), vec3(1.12, 1.14, 1.17),
          smoothstep(0.56, 0.80, cloudField));
        day = mix(day, cloudColor, cloud);
        day = mix(day, mix(vec3(.39,.46,.55),vec3(.64,.69,.75),horizon) + cloudNoise(cloudUv*.55)*.12, cloudCover*.85);
        day = mix(vec3(0.11, 0.105, 0.095), day, smoothstep(-0.16, 0.02, direction.z));

        if (night == 0.0) {
          COLOR = day;
        } else {
        vec3 afterDark = mix(vec3(0.004, 0.009, 0.026), vec3(0.040, 0.066, 0.105), horizon);
        float facingMoon = max(dot(direction, normalize(moonDirection)), 0.0);
        afterDark += vec3(0.10, 0.15, 0.25) * pow(facingMoon, 28.0);
        float moonDisc = smoothstep(0.99990, 0.99996, facingMoon);
        afterDark += vec3(2.1, 2.35, 2.7) * moonDisc * (1.0-cloudCover);
        vec2 starUv = vec2(atan(direction.y, direction.x), asin(clamp(direction.z, -1.0, 1.0))) * 160.0;
        vec2 starCell = floor(starUv);
        float star = step(0.989, hash21(starCell))
          * (1.0 - smoothstep(0.045, 0.18, length(fract(starUv) - 0.5)));
        afterDark += vec3(0.65, 0.76, 0.95) * star * smoothstep(0.1, 0.35, altitude) * (1.0 - cloud) * (1.0-cloudCover);
        afterDark = mix(afterDark, vec3(0.055, 0.075, 0.11), cloud * 0.35);
        afterDark = mix(vec3(0.008, 0.012, 0.018), afterDark, smoothstep(-0.16, 0.02, direction.z));
        COLOR = mix(day, afterDark, night);
        }


      }
