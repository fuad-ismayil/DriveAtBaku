import { readFileSync, writeFileSync } from 'node:fs';
const source = readFileSync('src/sky.js', 'utf8');
let code = /fragmentShader: `([\s\S]*?)`,\s*side:/.exec(source)?.[1];
if (!code) throw new Error('Web sky shader source changed');
code = code.replace(/varying vec3 vDirection;/, '')
  .replace('uniform float night, time, cloudCover;', 'uniform float night = 0.0; uniform float time = 0.0; uniform float cloudCover = 0.0;')
  .replace(/uniform vec3 sunDirection, moonDirection;/, 'uniform vec3 sunDirection = vec3(450,165,310); uniform vec3 moonDirection = vec3(270,190,590);')
  .replace(/\btime\b/g, 'sky_time')
  .replace('void main()', 'void sky()')
  .replace('normalize(vDirection)', 'normalize(vec3(EYEDIR.x,-EYEDIR.z,EYEDIR.y))')
  .replace(/gl_FragColor = vec4\(([^;]*), 1\.0\);/g, 'COLOR = $1;')
  .replace(/#include <[^>]+>/g, '');
// The cloud pattern stays static between weather changes, allowing Godot to
// cache its radiance instead of filtering a sky cubemap on every mobile frame.
writeFileSync('android/game/shaders/sky.gdshader', '// Generated from src/sky.js.\nshader_type sky;\n' + code.replace(/[\t ]+$/gm, '').trimEnd() + '\n');
