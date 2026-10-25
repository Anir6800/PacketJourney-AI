# Experience Spec

All colour and motion values live in `web/src/tokens.ts`. CSS receives them as custom properties (`--c-*`, `--dur-*`, `--ease-*`) via `applyTokens()`; GSAP imports the same numbers; `contrast.test.ts` measures the same colours. Change a value there, never in CSS.

## Direction
Dark holographic. Background gradient `#05070D` → `#0A1020` with a soft radial vignette and a faint perspective grid (hairline-colour lines, masked to fade toward the horizon). Glass panels `rgba(16,24,44,0.55)` with 16 px backdrop blur, 1 px hairline `rgba(140,180,255,0.14)`, inner top highlight, radius 18 px (10 px for inner controls). Panels over the 3D canvas use the **scrim** `rgba(8,12,26,0.86)` so text stays AA over any canvas pixel. Light comes from the data, not decoration.

## Layer system — colour + label + code + glyph shape
Colour is never the only signal.

| Layer | Colour | Code | Glyph shape | PDU |
|---|---|---|---|---|
| Application | violet `#A78BFA` | APP | diamond | message |
| Transport | sky `#38BDF8` | TRN | hexagon | segment (TCP) / datagram (UDP) |
| Internet | teal `#2DD4BF` | NET | circle | packet |
| Link | amber `#FBBF24` | LNK | rounded frame | frame |
| Physical (teaching view, **not a TCP/IP layer**) | pink `#F472B6` | PHY | wave | bits |

Status: success `#34D399` + ✓, danger `#F87171` + ✕. Text `#E6EEFF`, muted `#8FA3C7`. The SIMULATED badge uses Link amber with an outline.

## Typography
- Display/UI: **Space Grotesk** 500/700, headings tracked −0.02em.
- Data (bytes, addresses, fields, console, HUD labels): **JetBrains Mono** 400.
- `font-variant-numeric: tabular-nums` globally.
- HUD labels: mono, 0.72 rem, 0.14em tracking, uppercase. Units inside them (`.unit`) are never uppercased (µs must not become ΜS).

## Measured contrast (WCAG 2.x, AA = 4.5:1)
Measured by `web/src/contrast.test.ts` from tokens with alpha compositing (backdrop blur ignored; "scrim/white" assumes a pure white 3D pixel behind the scrim). All 36 pairs pass.

| Text | bg1 | glass/bg1 | active segment/glass | scrim/white (canvas worst case) |
|---|---|---|---|---|
| text | 16.28 | 15.70 | 11.74 | 11.61 |
| muted | 7.43 | 7.16 | 5.36 | 5.30 |
| app | 6.97 | 6.71 | 5.02 | 4.97 |
| transport | 8.85 | 8.53 | 6.38 | 6.31 |
| internet | 10.18 | 9.82 | 7.34 | 7.26 |
| link | 11.35 | 10.95 | 8.19 | 8.10 |
| physical | 7.16 | 6.90 | 5.16 | 5.10 |
| success | 9.86 | 9.51 | 7.11 | 7.03 |
| danger | 6.85 | 6.61 | 4.94 | 4.89 |

Phase 02 added "highlighted byte / scrim / white" (byte cell 60% dark + 12% blue tint): text 12.40, muted 5.66, app 5.31, transport 6.74, internet 7.76, link 8.65, physical 5.45, success 7.51, danger 5.22. A 22% tint failed (app 4.23, physical 4.35, danger 4.16) and was reduced; the 2 px outline carries the highlight.

Disabled controls (opacity 0.55) are exempt under WCAG 1.4.3 and are always accompanied by a NOT BUILT label.

## Motion tokens
| Token | Value | GSAP ease | CSS ease | Use |
|---|---|---|---|---|
| `micro` | 160 ms | — | `--ease-out` | hover glow, colour changes |
| `tab` | 240 ms | — | `--ease-out` | tab underline morph |
| `panel` | 280 ms | `power3.out` | `cubic-bezier(.215,.61,.355,1)` | drawer open/close |
| `stagger` | 75 ms | — | — | HUD panel entrance |
| `bootMax` | 2.5 s | — | — | upper bound for intro |
| `inOut` | — | `expo.inOut` | `cubic-bezier(.87,0,.13,1)` | camera (later) |

Later-phase tokens (`wrap`, `hop`, `camera`, `type`) are added to `tokens.ts` when their phase uses them.

### Boot sequence (≈2.1 s, ≤ 2.5 s)
0.0 grid fades in (0.5 s) → 0.2 wordmark decodes with ScrambleText (1.0 s) → 0.6 HUD panels enter, y 12→0 + fade, 75 ms stagger → 1.6 SIMULATED badge settles last (back.out). Any key or click jumps to the end. Plays once per session (`sessionStorage['pj.booted']`, written on completion). Under Reduced motion it never runs. StrictMode: decision fixed in `useState`; the dev double-mount reverts and restarts the same timeline, so it completes exactly once (e2e-verified).

### Ambient
Grid drift (8 s linear loop, CSS) — stops under Reduced and when `document.hidden`. No blinking anywhere (console caret is static).

### Reduced motion
`html[data-motion=reduced]` disables all CSS transitions/animations; no GSAP timelines are created; TypedConsole shows full text.

## Layout
- **> 1280 px**: HUD bar · left rail 300 px · centre stage · right inspector 360 px · bottom timeline dock.
- **769–1280 px**: rail 280 px + stage; inspector becomes a right drawer (HUD "Inspector" button, Esc to close, `inert` when closed, focus moves into it on open).
- **≤ 768 px**: single column, stage first, then rail, inspector, dock; tabs wrap; no horizontal scroll.
- Stage tabs: Journey, Headers, Delivery scopes, Compare, Practice (arrow keys, Home/End, roving tabindex).

## UI state catalogue
| Component | States |
|---|---|
| Button | default · hover (160 ms glow) · focus-visible (2 px sky ring) · pressed (`aria-pressed`, tinted bg + sky underline) · disabled (0.55 opacity, not-allowed cursor) · primary |
| Segmented control | one pressed option; group labelled (`Mode`, `Protocol`, `Motion`, `View`, `Playback`) |
| Tabs | selected (text colour + morphing underline) · unselected (muted) · hover · focus |
| Input/select | default · focus · invalid (danger border + `role=alert` message with ✕) |
| Layer row | default · hover glow in layer colour · selected (`aria-pressed`) |
| Badge | SIMULATED (amber outline, always visible) |
| HUD label | uppercase mono section label |
| StateView | **empty** (◌, `role=status`; used for NOT BUILT tabs) · **loading** (◔, `role=status`; 3D chunk) · **error** (✕ danger, `role=alert`) |
| AI status | checking… · online · server up · AI not configured · offline · core app unaffected |
| Inspector | panel (> 1280) · drawer closed (inert) · drawer open · stacked (≤ 768) |
| TypedConsole | typing (static caret) · line complete · all complete · reduced (instant) |
| Boot | playing · skipped · completed · not played (session/reduced) |
| Stage | 3D loading · 3D ready · 2D fallback (reason: View 2D / WebGL unavailable / context lost) |

## TypedConsole contract
`<TypedConsole lines cps reduced label />` — types at `cps` chars/s (default 55), 220 ms pause between lines; Enter or click completes the current line instantly; finished lines go to a visually hidden `role=log aria-live=polite` region exactly once; Reduced shows all lines immediately. Remount (via `key`) to restart. Lines must come from engine snapshots (phase 01 uses the typed preview fixture in `web/src/fixture.ts`).

## Story Mode storyboard
| Chapter | Beats |
|---|---|
| 0 · Prologue | Title; "Everything here is simulated"; choose Cinematic/Reduced |
| 1 · The message | Q: what will you send? → typed text → UTF-8 bytes (text/hex/binary) |
| 2 · The choice | Q: TCP or UDP? → trade-off card |
| 3 · The destination | Q: where is the receiver? (same host / same link / another network) |
| 4 · Wrap | Transport shell → Internet shell → Link frame, each with checksum moment |
| 5 · Handshake (TCP) | SYN, SYN+ACK, ACK with seq/ack numbers |
| 6 · Journey | ARP if needed; hop by hop; TTL decrements; MAC rewrite per router |
| 7 · Unwrap | Receiver strips frame → packet → segment; checksum verify |
| 8 · Reply & close | Response; ACKs; FIN exchange (TCP) |
| 9 · Recap | Layer summary, predictions scored, "what was simplified" |

## Camera rigs (3D, Cinematic only)
Overview (wide, elevated) · Stack (close orbit on one host) · Follow (trails packet) · Router (low angle at router). Reduced: fixed Overview.

## Performance budgets (targets)
| Budget | Target | Measured |
|---|---|---|
| Initial JS before 3D chunk (gzip) | ≤ 150 KB | build output 125.76 KB gzip (phase 01); runtime NOT MEASURED |
| Lazy 3D chunk (gzip) | ≤ 300 KB | build output 241.90 KB gzip |
| Draw calls per frame | ≤ 100 | 1 smoke mesh only; real scene NOT MEASURED |
| DPR cap | 2 | enforced `dpr={[1, 2]}` |
| Frame time (Cinematic, mid laptop) | ≤ 16.7 ms | NOT MEASURED |

## Accessibility
- Essential text in DOM; WebGL is backdrop only.
- `prefers-reduced-motion` → Reduced by default (live media query until user chooses).
- Every control keyboard-reachable; visible focus ring; tabs use arrow keys; Esc closes dialog/drawer.
- Layers: colour + code + name + glyph shape.
- Measured AA contrast above; scrim over canvas.
- Wordmark scramble is `aria-hidden`; screen readers get the static name.
- No flashing; no perpetual blinking.
