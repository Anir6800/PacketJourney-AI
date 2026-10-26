import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const roots = ['web/src', 'web/dist/assets'];
const failures = [];
let checked = 0;
function visit(dir) {
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, item.name);
    if (item.isDirectory()) { visit(path); continue; }
    if (!/\.(?:css|tsx?|js)$/.test(item.name)) continue;
    checked++;
    const source = readFileSync(path, 'utf8');
    for (const match of source.matchAll(/#[\da-f]{3}(?:[\da-f]{3})?(?:[\da-f]{2})?\b|rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+(?:\s*,\s*[\d.]+)?\s*\)|hsla?\(\s*\d+[^)]*\)/gi)) {
      const value = match[0];
      if (value.startsWith('hsl')) { failures.push(`${path}: ${value}`); continue; }
      const channels = value.startsWith('#')
        ? value.length === 4 ? [...value.slice(1)].map((v) => parseInt(v + v, 16))
          : [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16))
        : [...value.matchAll(/\d+/g)].slice(0, 3).map((v) => Number(v[0]));
      if (channels[0] !== channels[1] || channels[1] !== channels[2]) failures.push(`${path}: ${value}`);
    }
  }
}
for (const root of roots) visit(root);
if (failures.length) {
  console.error(`Non-grayscale literals (${failures.length}):\n${failures.slice(0, 30).join('\n')}`);
  process.exitCode = 1;
} else console.log(`Monochrome source/build scan: ${checked} files, no hued color literals.`);
