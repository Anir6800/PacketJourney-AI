# Demo Script

Phase 17 (monochrome liquid glass, message-first entry). Every packet, timing and result is **SIMULATED**.

1. `npm run dev` → open http://127.0.0.1:5173 in a new tab (the entry shows once per browser session).
2. The first screen is pure black with one glass field, "Enter a message", its live UTF-8 byte counter and a small `SIMULATED · local` tag. Type `héllo ✓` and point out **10 / 256 bytes UTF-8** (é and ✓ are multi-byte).
3. Press **Enter**: the browser is asked for fullscreen (denial is silent; **F** toggles, **Esc** exits). The questions follow one at a time: TCP/UDP, ports, same LAN or routed, raw/HTTP, fault, confirm. Enter accepts the pre-selected default; Backspace goes back; **Skip - use defaults** starts at once.
4. Boot screen (≤ 3 s, any key skips): the mono lines are read from this run (byte count, transport header, IPv4 total length, Ethernet frame incl. FCS, checksums) and end with `SIMULATED run ready`.
5. Opening: the typed message moves to the centre, scrambles into its real hex bytes and becomes the white core; Application → Transport (dashed) → Internet (frosted) → Link (double) → bits shells form one by one on the master timeline.
6. A white sweep reveals the scene: on a wide screen only the 3D journey, the playback dock and two buttons remain. **☰ Menu** (left drawer) holds modes, protocol, motion, view, sections and the Story/Director/Lab panel; **ⓘ Details** (right drawer) holds the inspector and journey data. Clicking a device or shell opens Details. In fullscreen the dock and buttons hide after 2.5 s idle.
7. Step the Journey chapter: in 3D the shells keep their line styles (no colour); switch **View → 2D** and the same nested shells appear as SVG above the 2D journey.
8. **Lab** → Faults → drop the first data packet → Run: the drop shows as an inverted white panel `DROPPED - simulated` and a struck-through packet marker; TCP retransmits.
9. **Compare**, **Practice** and the **Tutor** (built-in explanations without any key) are under **☰ Menu → Section** and in **ⓘ Details**.
10. **Director**: from the entry screen press **Alt+D**: a preset message types itself, boots and plays as Director. Space pauses, arrows step, Esc exits.
11. **Motion → Reduced** (or the OS setting): no automatic fullscreen, typing, scramble, morph, sweep or camera moves; every state remains steppable.
12. **☰ Menu → New message** returns to the entry screen.
