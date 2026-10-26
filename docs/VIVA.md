# Viva notes · design answers (phase 17)

**Why is the interface monochrome?** Colour was the only thing separating layers in the phase 01 design. Removing hue forces every distinction to be redundant and colour-blind safe: each layer keeps its name, code (APP/TRN/NET/LNK/PHY) and glyph, plus a line style (Application solid white core, Transport dashed, Internet frosted glass, Link double line, Physical dotted bits). `npm run check:monochrome` scans source and the production build for any non-grey colour literal; a Playwright test samples 3D canvas pixels for |R−G| and |G−B| ≤ 6.

**How are success and failure shown without green and red?** Success is a ✓ glyph with text. Failure is an inverted panel (white fill, black text) with ✕ and text. A dropped frame is struck through and labelled `DROPPED - simulated`.

**Is the text readable on glass?** Glass is white at 5% over black with backdrop blur and `saturate(0)`, so nothing behind it can tint it. `web/src/contrast.test.ts` measures every text token on each real backing (glass over black and over #0A0A0A, #111111 and #1A1A1A; active and primary buttons; the 3D scrim over a white pixel; the inverted panel). The lowest is 4.97:1, so all pass WCAG AA 4.5:1.

**Does the cinematic change the simulation?** No. The engine, events, cues and facts are unchanged. The opening and boot read the run's snapshot, and the opening is a child of the paused GSAP master timeline seeked by the one playback clock.

**What happens on slow hardware?** Twelve back-to-back slow frames (over 50 ms) switch the shells from `MeshTransmissionMaterial` to `MeshPhysicalMaterial` and turn off bloom and vignette (`web/src/scene/budget.ts`, unit-tested). Under headless SwiftShader this happens during playback. Frame timing on real hardware is **NOT MEASURED**.

**Accessibility of fullscreen and auto-hide?** Fullscreen is requested only from the Enter gesture, never under Reduced motion; denial is ignored. Hidden chrome uses opacity only, so it stays in the accessibility tree; focus inside it wakes it and blocks hiding.
