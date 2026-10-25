# AGENTS.md — conventions

- Read `docs/SPEC.md`, `docs/PROTOCOL_MODEL.md`, `docs/EXPERIENCE.md`, `docs/STATUS.md` before changing anything.
- Workspaces: `shared/` (schemas, later the engine), `server/` (optional local AI), `web/` (UI).
- Strict TypeScript; no `any`, no non-null assertions.
- Engine code is pure and deterministic (seeded). Views render snapshots; they never compute protocol facts.
- GSAP: import from `web/src/gsap.ts` (single plugin registration). Use `useGSAP` with a scope; never let GSAP own simulated time.
- 3D is lazy-loaded; essential text stays in the DOM; every 3D step has a 2D SVG equivalent.
- Respect Motion = Reduced: no camera moves, typing, scramble or bloom pulses.
- Label everything simulated as SIMULATED; unbuilt features say NOT BUILT; unmeasured performance says NOT MEASURED.
- Secrets only in `.env` (server). Never `VITE_`-prefix a secret.
- Before handoff: `npm run verify`; update `docs/STATUS.md`, `docs/DECISIONS.md`, `docs/TEST_EVIDENCE.md`.
- No pushes or deploys unless asked. No destructive git commands.
