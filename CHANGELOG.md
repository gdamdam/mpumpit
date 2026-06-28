# Changelog

All notable changes to mpumpit are documented here. This project adheres to
[Semantic Versioning](https://semver.org/).

## [0.2.0] — 2026-06-28

### Added
- **Computer-keyboard drum mode** — when the keyboard targets the drums part,
  the white-key row plays mpump's 10 drum voices (A = kick, S = rim, D = snare,
  F/G = hats, …) instead of chromatic pitches.

### Changed
- Keyboard default octave lowered to **C3** (was middle C), and the readout now
  shows the real root note (e.g. `Root C3`) in scientific pitch, not an
  octave-shift counter.
- When the computer keyboard is enabled, its note keys take precedence over a
  focused `<select>`/number field — no overlapping shortcuts swallow notes.

### Fixed
- Retargeting the keyboard to **bass** or **drums** now works (it previously
  appeared stuck on synth because a focused menu swallowed the keys and drum
  notes were out of the playable range).

## [0.1.0] — 2026-06-28

Initial release.

### Added
- Browser MIDI sound module driving mpump's AGPL audio engine (synth / bass /
  drums) with the full master FX chain and per-part channel strips.
- MIDI input router: channel routing (synth = 1, bass = 2, drums = 10),
  ref-counted active-note ownership, velocity-0 note-off, CC 120/123, hot-plug,
  disconnect cleanup, all-inputs mode, clock-safe handling; no MIDI output.
- **Computer-keyboard input** (Ableton-style QWERTY layout) playing a selectable
  part, with octave (Z/X) and velocity (C/V) control.
- Documented, editable midip↔mpump drum compatibility map.
- localStorage persistence, hardware-faceplate UI, permanent PANIC, and a
  version readout.

### Fixed (post-review hardening)
- **Synth/bass EQ & HPF** no longer present as inaudible controls — the
  poly-synth worklet bypasses those channel-bus nodes, so the strip now exposes
  only what is audible (pan + gate) for synth/bass; EQ/HPF remain for drums,
  which route through the real bus.
- **Sidechain Duck** now activates the engine's real sidechain
  (`setSidechainDuck` / `setDuckParams`) instead of a no-op insert effect.
- **PANIC** stops drum one-shots (not just synth/bass voices); hard panic
  (double-click) flushes the FX chain so delay/reverb tails cannot return.
- **Readiness** waits for the poly-synth worklet specifically; a failed load is
  surfaced as a visible warning (drums still work) instead of silently dropping
  notes.
- **Pre-start MIDI** is tracked as held notes, not a raw event log, so overflow
  can never replay an orphan note or leave a hung note.
- A saved-but-disconnected MIDI input is shown honestly as “disconnected”
  instead of masquerading as “All MIDI inputs”.
