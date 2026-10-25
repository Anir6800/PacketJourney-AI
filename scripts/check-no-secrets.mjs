// Fails if web source or build output references server-only secrets or key-shaped strings.
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const roots = ['web/src', 'web/dist', 'web/index.html'];
const patterns = [/AI_API_KEY/, /\bsk-[A-Za-z0-9_-]{20,}/, /\bAIza[0-9A-Za-z_-]{30,}/];
const hits = [];

function scan(p) {
  if (!existsSync(p)) return;
  if (statSync(p).isDirectory()) return readdirSync(p).forEach((f) => scan(join(p, f)));
  const text = readFileSync(p, 'utf8');
  for (const re of patterns) if (re.test(text)) hits.push(`${p}: ${re}`);
}

roots.forEach(scan);
if (!existsSync('web/dist')) console.warn('warn: web/dist missing; run build first for a full scan');
if (hits.length) {
  console.error('Secret-like content found:\n' + hits.join('\n'));
  process.exit(1);
}
console.log(`check-no-secrets: clean (${roots.filter(existsSync).join(', ')})`);
