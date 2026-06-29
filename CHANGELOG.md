# Changelog

All notable changes to mpumpit are documented here. This project adheres to
[Semantic Versioning](https://semver.org/).

## [0.4.0] — 2026-06-28

### Fixed
- **No sound / no MIDI received** even with a connected, selected input: the
  `midimessage` listener was attached with `addEventListener` but the port was
  never opened. Per the Web MIDI spec a port opens implicitly only when
  `onmidimessage` is set, so some browsers (and virtual ports like the macOS IAC
  bus) delivered nothing. Each selected input is now explicitly `open()`ed.

### Added
- The **MIDI-IN indicator now blinks on any inbound message**, even on an
  unrouted channel — so "device sending but silent" (channel mismatch) is
  distinguishable from "nothing arriving" (connection problem).

## [0.3.0] — 2026-06-28

### Added
- Keyboard routing toggle. **Direct** (default) plays the chosen part directly;
  **Over MIDI** layers the keyboard through the MIDI router on the part's
  channel — over the live MIDI signal — so channel routing and the drum-map
  apply, exactly like an external controller.

### Fixed
- **(P2)** Saved synth/bass pan & gate were sent to the poly-synth worklet
  before it loaded (it loads async), so they read as restored in the UI but
  were inaudible after a reload. They're now re-applied once the worklet is
  ready.
- **(P2)** The computer keyboard's explicit target was re-resolved through MIDI
  channels, so duplicate channel assignments could route to the wrong part and
  drum-map overrides could make "A = kick" play another voice. In the default
  Direct routing the target part is now honored exactly, bypassing channel
  resolution and the drum-map.

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
