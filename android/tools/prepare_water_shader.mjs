import { readFileSync, writeFileSync } from 'node:fs';
const source = readFileSync('src/vehicleWater.js', 'utf8');
const match = /const WATER_GLSL = \/\* glsl \*\/`([\s\S]*?)`;/m.exec(source);
if (!match) throw new Error('Web water shader source changed');
// Keep the actual bead, cap and filtering functions shared with the web source.
const functions = match[1].slice(match[1].indexOf('vec3 carWaterHash'));
writeFileSync('android/game/shaders/car_water.gdshaderinc', '// Generated from src/vehicleWater.js by prepare_water_shader.mjs.\n' + functions);
