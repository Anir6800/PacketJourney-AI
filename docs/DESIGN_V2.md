# Design V2 · Phase 17

This document supersedes the visual and motion values in `EXPERIENCE.md`. The protocol model, immutable events, cue builder and playback clock remain the source of every displayed fact. All timings and packet results are **SIMULATED**.

## Baseline and target

Phase 15 passed the engineering gate (245 Vitest and 55 Playwright tests). Baseline captures of Story, Lab Journey in 3D and 2D, Headers, Delivery scopes, Compare, Practice and Director at 1440 × 900 and 390 × 844 are in `docs/evidence/phase17/before/`. The baseline shows a colored three-column dashboard at first paint; the new first paint is a single message input on black. The detailed teaching controls remain reachable after entry.

## Tokens

| Role | Value | Use |
|---|---|---|
| Canvas | `#000000` | Entry, boot, scene surround |
| Surface 1 / 2 / 3 | `#0A0A0A` / `#111111` / `#1A1A1A` | Nested panels and controls |
| Glass | white at 5% | Floating controls; blur 24px, saturate(0) |
| Hairline | white at 12% | 1px borders; 8% to 16% allowed by placement |
| Main / secondary text | `#FAFAFA` / `#A3A3A3` | Normal informative text, AA on its actual backing |
| Tertiary | `#737373` | Nonessential meta text only |
| Success | white check + text | Never color alone |
| Failure | white field, black cross + text | Contrast inverted |
| Drop | struck packet + `DROPPED - simulated` | No red hue |

No hue is used in DOM, SVG, CSS, materials, lights, postprocessing or print. Application uses a solid core, Transport a dashed boundary, Internet frosted glass, Link a double boundary, and physical transmission white particles. Codes, glyphs and labels remain explicit; line style alone is insufficient. Geist or Inter is bundled locally for interface text, JetBrains Mono for bytes, addresses and times. Numerals are tabular. Spacing follows 8px increments where content permits. Focus is a white 2px outline with visible offset.

Glass has a white 3–6% fill, 24px backdrop blur and zero saturation, a white 12% edge, a brighter 1px top highlight and a soft black shadow. On fine pointers, a radial white sheen follows the cursor through CSS variables updated at most once per animation frame. It is disabled on touch and Reduced motion. Any distortion is decorative only; legible text and controls are never filtered.

## Entry and navigation

1. **Entry** occupies 100dvh in black. The only visible controls are a centered labeled input with placeholder `Enter a message`, its live UTF-8 byte count and validation (1–256 bytes), plus `SIMULATED · local` in a corner. The input receives focus. A new session and `New message` return here.
2. **Questions** reuse the same full-viewport frame. Protocol, ports, path, payload type and fault appear one at a time with an already selected default. Enter accepts; `Skip - use defaults` starts a run; Backspace on an empty focused answer returns to the previous question. The first Enter may request fullscreen, with rejection handled silently; F toggles and Esc exits. Reduced motion does not request fullscreen automatically.
3. **Boot** takes at most three seconds and is skippable by any key or pointer activation. Its mono rows are read from the actual run snapshot: UTF-8 length, transport header and unit size, IPv4 total, Ethernet frame/FCS and checksums. A thin white progress line fills with the sequence. The final line reads `SIMULATED run ready`.
4. **Journey** starts with the user's message centered. A cue-driven Flip transition moves it toward a payload core; glyphs briefly resolve into engine-produced hex; shells form Application → Transport → Internet → Link → physical bits, one hero move at a time. The existing paused GSAP master is still sought by the one playback clock, so scene facts and state remain deterministic when scrubbed.
5. **Chrome** appears after the opening or on pointer movement / I. The slim top bar, right inspector and bottom dock are glass sheets. In fullscreen, idle chrome hides after 2.5s and reappears on input; focus within it prevents hiding. Lab, Compare, Practice, Tutor and Director remain one action away. Director can start from the entry screen with a preset message. The 2D SVG journey retains all semantic steps.

## Motion and 3D

Scene moves last 0.5–1.2s with `expo.inOut` or `power4.out`; UI responses last 160–240ms. Text reveals by a clipped line or 12–20ms glyph stagger. Glass sheets rise 12px from soft to sharp. A white sweep or iris marks a major scene change. No conspicuous perpetual loop. Reduced motion renders final states immediately and disables fullscreen auto-request, camera motion, typing, scramble, sheen and bloom pulses. Hidden tabs pause playback and drift.

3D shells use grayscale drei `MeshTransmissionMaterial` with `chromaticAberration={0}`, low samples and resolution. Repeated missed frame budgets switch the shell to `MeshPhysicalMaterial`; the switch is observable in the test hook. White emissive edges and high-threshold white bloom preserve the layer forms. Environment light is procedural grayscale. The canvas renders on demand while paused, caps DPR at 2 and restores the 2D journey on context loss. Frame timing must be measured with browser tooling and stated with machine and scenario, or marked **NOT MEASURED**.

## As built (phase 17)

- Tokens live in `web/src/tokens.ts` (all greys) and are injected as CSS custom properties; layer line styles for SVG are `LAYER_LINE` in `web/src/layers.tsx`. The 2D stage (`Stage2D`) draws the current packet's nested shells from the same pure scene model as 3D.
- 3D: Transport and Link shells carry camera-facing rings (dashed / double) whose opacity follows the shell; Internet uses a rougher (frosted) transmission material. The frame-budget rule is `web/src/scene/budget.ts` (12 back-to-back frames over 50 ms).
- Chrome: the dock is sticky at the viewport bottom from 769px; the inspector stays a sticky right sheet above 1280px and a drawer below. Idle chrome fades only in fullscreen and returns instantly.
- Tertiary `#737373` is not used for any text (its 4.42:1 on black misses AA); small meta text uses the secondary grey.
- Optional SVG refraction (feTurbulence/feDisplacementMap) is **NOT BUILT**; glass is blur + specular edge + cursor sheen only.

## Verification contract

The first screen has only the entry controls in the DOM. Browser journeys cover desktop and 390 × 844, fullscreen success/denial, skip/back, boot value equality, 3D and 2D, Reduced motion, focus-safe chrome, context loss, and the existing Phase 15 behavior. Static scanning checks all source and built CSS/JS colors for grayscale only; pixel sampling checks the canvas. Measured contrast covers informative text on each actual glass backing. Screenshots before and after are opened and inspected for overlap, small text, clipping and broken arrows. Any unbuilt capability is labeled **NOT BUILT**; physical performance without a recorded measurement is **NOT MEASURED**.

Sources: [GSAP installation and free npm plugins](https://gsap.com/docs/v3/Installation/), [Drei MeshTransmissionMaterial](https://drei.docs.pmnd.rs/shaders/mesh-transmission-material). Protocol sources and simplifications remain in `PROTOCOL_MODEL.md`.
