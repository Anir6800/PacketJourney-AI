# PacketJourney AI

A local, educational TCP/IP visualizer. Everything shown is **SIMULATED** — the browser opens no real sockets and captures no traffic.

## Run

Requires Node ≥ 22.

```sh
npm ci
npm run dev        # server on 127.0.0.1:8787, web on http://127.0.0.1:5173
```

The AI tutor is optional. Copy `.env.example` to `.env` and fill `AI_BASE_URL`, `AI_MODEL`, `AI_API_KEY` to enable it. The app runs fully without it.

## Scripts

| Script | Does |
|---|---|
| `dev` | server + web dev servers |
| `build` | production build of web |
| `typecheck` | `tsc` across shared, server, web, e2e |
| `lint` | ESLint |
| `test` | Vitest unit tests |
| `test:e2e` | Playwright (run `npx playwright install chromium` once) |
| `verify` | all of the above + secret scan |

## Docs

`docs/SPEC.md` · `docs/PROTOCOL_MODEL.md` · `docs/EXPERIENCE.md` · `docs/STATUS.md` · `docs/DECISIONS.md` · `docs/TEST_EVIDENCE.md`
