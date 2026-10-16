import { mkdirSync, copyFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';

// Build a self-contained source bundle without shipping machine-specific deps.
mkdirSync('artifacts/android', { recursive: true });
// Fresh staging prevents a previous bundle test's npm install from being packed.
const output = mkdtempSync(resolve('artifacts/android/relay-source-'));
for (const directory of ['server', 'src/net', 'tools']) mkdirSync(join(output, directory), { recursive: true });
for (const path of ['server/server.js', 'server/package.json', 'server/package-lock.json', 'src/net/indicatorProtocol.js']) {
  copyFileSync(path, join(output, path));
}
copyFileSync('android/tools/probe_relay.mjs', join(output, 'tools/probe_relay.mjs'));
copyFileSync('docs/android/RELAY_UPDATE.md', join(output, 'READ-ME-FIRST.md'));
writeFileSync(join(output, 'package.json'), JSON.stringify({ private: true, type: 'module', engines: { node: '>=22' } }, null, 2));
mkdirSync('android/build', { recursive: true });
const archive = resolve('android/build/DriveAtBaku-relay-update.zip');
const quote = value => "'" + value.replaceAll("'", "''") + "'";
const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', `Compress-Archive -Path ${quote(join(output, '*'))} -DestinationPath ${quote(archive)} -Force`], { windowsHide: true, encoding: 'utf8' });
if (result.status !== 0) throw new Error(result.stderr || result.stdout);
console.log(archive);
