import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HealthResponse } from '@packetjourney/shared';
import { createApp } from './app.ts';

let base = '';
let close: () => void = () => {};

beforeAll(async () => {
  const server = createApp({}).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => server.close();
});
afterAll(() => close());

describe('/api/health', () => {
  it('returns a schema-valid body with AI unconfigured', async () => {
    const res = await fetch(`${base}/api/health`);
    expect(res.status).toBe(200);
    const body = HealthResponse.parse(await res.json());
    expect(body.aiConfigured).toBe(false);
  });

  it('allows a local dev origin', async () => {
    const res = await fetch(`${base}/api/health`, { headers: { Origin: 'http://127.0.0.1:5173' } });
    expect(res.headers.get('access-control-allow-origin')).toBe('http://127.0.0.1:5173');
  });

  it('rejects foreign origins', async () => {
    const res = await fetch(`${base}/api/health`, { headers: { Origin: 'https://evil.example' } });
    expect(res.status).toBe(403);
  });
});
