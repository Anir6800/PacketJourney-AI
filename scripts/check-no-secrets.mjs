// Fails if web source or build output references server-only secrets or key-shaped strings.
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const roots = ['web/src', 'web/dist', 'web/index.html'];
const patterns = [/AI_API_KEY/, /\bsk-[A-Za-z0-9_-]{20,}/, /\bAIza[0-9A-Za-z_-]{30,}/, /\bnvapi-[A-Za-z0-9_-]{20,}/];
// The configured key itself (if a local .env exists) must never appear in web sources or the build. Never printed.
const envKey = existsSync('.env') ? /^AI_API_KEY=(.+)$/m.exec(readFileSync('.env', 'utf8'))?.[1]?.trim() : undefined;
const hits = [];

function scan(p) {
  if (!existsSync(p)) return;
  if (statSync(p).isDirectory()) return readdirSync(p).forEach((f) => scan(join(p, f)));
  const text = readFileSync(p, 'utf8');
  for (const re of patterns) if (re.test(text)) hits.push(`${p}: ${re}`);
  if (envKey && envKey.length > 8 && text.includes(envKey)) hits.push(`${p}: contains the configured AI_API_KEY value`);
}

roots.forEach(scan);
if (!existsSync('web/dist')) console.warn('warn: web/dist missing; run build first for a full scan');
if (hits.length) {
  console.error('Secret-like content found:\n' + hits.join('\n'));
  process.exit(1);
}
console.log(`check-no-secrets: clean (${roots.filter(existsSync).join(', ')})`);
