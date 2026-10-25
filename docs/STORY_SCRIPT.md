# Story Script (stub)

NOT BUILT. Chapters follow the storyboard in `EXPERIENCE.md`. Every line containing a value (byte, port, seq, TTL, checksum) must be a template filled from an engine snapshot, never literal text.

| Chapter | Narration (template) | Question | Snapshot fields used |
|---|---|---|---|
| 0 | "Everything you will see is simulated." | — | — |
| 1 | "Your message is {byteCount} bytes of UTF-8." | What will you send? | payload.bytes |
| 2 | — | TCP or UDP? | session.protocol |
| 3 | — | Where is the receiver? | scenario.scope |
| 4–9 | TBD in the Story phase | | |
