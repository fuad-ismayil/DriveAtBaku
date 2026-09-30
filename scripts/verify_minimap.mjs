import assert from 'node:assert/strict';
import { drawMinimap } from '../src/minimap.js';

const moves = [];
const context = new Proxy({}, {
  get(target, property) {
    if (property === 'moveTo') return (x, y) => moves.push([x, y]);
    return target[property] ?? (() => {});
  },
  set(target, property, value) { target[property] = value; return true; },
});
const canvas = { width: 220, getContext: () => context };
const route = { checkpoints: [[0, 0], [100, 0], [100, 100], [0, 100]] };

drawMinimap(canvas, route, { x: 0, y: 0 }, 0);
const initial = moves[0];
moves.length = 0;
drawMinimap(canvas, route, { x: 25, y: 0 }, 0);
const moved = moves[0];
moves.length = 0;
drawMinimap(canvas, route, { x: 25, y: 0 }, Math.PI / 2);
const turned = moves[0];

assert.notDeepEqual(initial, moved, 'route must scroll when the car moves');
assert.notDeepEqual(moved, turned, 'route must rotate when the car turns');
console.log('Minimap follows position and heading.');
