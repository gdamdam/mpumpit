# Changelog

All notable changes to mpumpit are documented here. This project adheres to
[Semantic Versioning](https://semver.org/).

## [0.5.0] — 2026-06-29

### Added
- **Sound editor.** Each part's **Edit** button opens a full-screen, full-parity
  editor: synth/bass OSCILLATOR / FILTER / LFO with live **ADSR**, **filter
  response** and **LFO** visualizations; drums with a per-voice picker, all voice
  params, and a **▶ Test** audition. Presets are a live override that persists
  (a **✎** marks an edited part); **Save as…** stores named **user presets** in
  localStorage, **Reset** reloads the preset.
- Saved state now includes per-part sound params, drum voices and user presets;
  older saved state hydrates its params from the named preset (back-compat).
- README and in-app help (`?`) updated to cover the editor and keyboard.

## [0.4.4] — 2026-06-29

### Changed
- The **mpumpit** wordmark is now rendered as half-block pixel art in mpump's
  actual logo style (same glyphs as mpump's "MPUMP" logo, extended with I/T),
  replacing the Chakra Petch attempt. Reverted the bundled font.

## [0.4.3] — 2026-06-29

### Changed
- The **mpumpit** wordmark briefly used Chakra Petch (reverted in 0.4.4 — the
  mpump logo is pixel block-art, not Chakra Petch).

## [0.4.2] — 2026-06-29

### Fixed
- Direct computer-keyboard notes now share active-note ownership with inbound
  MIDI (routed through the router, ref-counted). A note held by both a
  controller and the keyboard is no longer cut when only one of them releases.
- `open()`'s returned promise rejection is now caught; a port that fails to open
  is removed from the listened set so the diagnostics don't claim it's listening.
- Diagnostics "MIDI rx" now counts every inbound message (CC, pitch bend,
  program change, clock, sysex), not just notes — so it reliably shows whether
  any MIDI is arriving. The MIDI-IN LED still ignores clock/realtime so it
  doesn't sit solid.
- The disposed (StrictMode) router's pending grant can no longer overwrite the
  live router's UI state with idle — stale results are ignored by identity.

## [0.4.1] — 2026-06-28

### Fixed
- **Still no MIDI received on v0.4.0.** Inputs were attached with
  `addEventListener("midimessage")`, but Chrome only *opens* an input port — and
  only dispatches messages — when the `onmidimessage` IDL attribute is set, so a
  virtual bus (macOS IAC / loopMIDI) delivered nothing. Now set `onmidimessage`
  directly. Also guard against React StrictMode attaching a zombie listener set.

### Added
- A small **diagnostics line** under MIDI IN: messages received, inputs being
  listened to, AudioContext state, and synth-engine status — so the signal path
  is visible at a glance.

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
