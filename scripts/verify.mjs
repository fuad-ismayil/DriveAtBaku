import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Browser suites need a running server and a hardware-accelerated Chrome session.
const browserSuites = new Set([
  'verify-foliage-browser',
  'verify-city-map-browser', 'verify-city-cleanup-browser',
  'verify-government-house-browser',
  'verify-room-lights-browser',
  'verify-graphics-settings-browser', 'verify-resolution-browser',
  'verify-interface-browser',
  'verify-desktop-parity-browser', 'verify-mobile-download',
  'verify-weather', 'verify-vehicle-water', 'verify-vehicle-water-distance',
  'verify-indicators-browser',
]);
const { scripts } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
let completed = 0;
for (const [name, command] of Object.entries(scripts)) {
  if (!name.startsWith('verify-') || browserSuites.has(name)) continue;
  console.log(`\n${name}`);
  const [executable, ...args] = command.split(' ');
  const result = spawnSync(executable, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  completed++;
}
console.log(`\n${completed} verification suites passed.`);
