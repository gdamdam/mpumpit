# Changelog

All notable changes to mpumpit are documented here. This project adheres to
[Semantic Versioning](https://semver.org/).

## [1.2.1] — 2026-06-30

### Fixed
- **Drums obey MASTER volume when *Drums → FX* is off.** With *Drums → FX*
  disabled, drums bypassed the FX chain by joining at the drive stage — *after*
  the master-volume node — so the MASTER fader had no effect on them. The drums
  bypass gain now tracks master volume (kept in sync on every volume change and
  the resume heartbeat), so drums respond to MASTER in both routings.
- **Persisted synth params are fully validated.** Loaded `SynthParams` were
  shape-cast without checking field values; a hand-edited or corrupt save could
  push out-of-range numbers or unknown enum values straight to the engine. Every
  field is now range-clamped (numbers) or enum/type-checked, defaulting
  individually, so the engine always receives a complete, valid param set.
- **Malformed user presets are normalized instead of trusted.** Saved synth/bass
  presets now have their params validated, and drum-kit presets with missing or
  non-object `voices` default to an empty set (loading as an all-default kit)
  rather than crashing kit selection. Presets without a string name are dropped.



### Fixed
- **Master effects now reach drums.** Drums were hardcoded to bypass the entire
  master FX chain (and EQ + multiband), so delay/reverb/distortion/etc. never
  applied to them and the per-effect *EXCL. DRUMS* toggle was a silent no-op.
  Drums now route through the master FX chain by default, exactly like synth and
  bass (matching the documented design), and *EXCL. DRUMS* works per effect.

### Added
- **Master output (mastering) section** in the FX panel's master view, exposing
  engine controls that were previously unreachable from the UI: 3-band master EQ
  + low-cut, multiband compressor (on + amount), limiter mode (off/limiter/
  hybrid), drive, output boost, stereo width, and a **Drums → FX** toggle. All
  settings persist across reload (added to `SoundState` with field-by-field
  normalization) and a **Reset** button restores engine defaults. Older saves
  without a `master` block fall back to defaults — backward compatible.

## [1.1.1] — 2026-06-29

### Fixed
- **Audio init can be retried after a failure.** If engine creation, `resume()`,
  or worklet init rejects, SoundModule now tears down the partial engine and
  resets, so a second "Start Audio" builds a fresh engine instead of replaying
  the rejected promise. Concurrent successful calls still share one init.
- **Slow-loading worklet no longer drops synth/bass notes.** AudioPort queues
  live synth/bass notes (bounded, Note On/Off-correct) while the poly-synth
  worklet loads and replays the still-held ones on a late load, re-applying
  worklet-owned params/volume/pan/trance-gate and notifying SoundModule, which
  clears the degraded warning (or marks definitive failure).
- **Malformed persisted state can't crash the app.** Persisted `soundState` is
  normalized field-by-field against defaults (non-array `effectOrder`, null
  effects, non-array preset lists, bad part/strip/voice/drumMap shapes, out-of-
  range numerics), keeping valid/older-partial data and never throwing.
- **Debounced settings survive refresh/navigation.** The pending save is flushed
  synchronously on `pagehide` and effect cleanup before the timer is cancelled;
  a "Reset all settings" wipe is no longer undone by a trailing flush.
- **CV gate is genuinely ref-counted by channel + note.** The same pitch held on
  synth and bass are independent owners (releasing one keeps the gate high), and
  per-channel all-notes-off clears only that channel's CV ownership.

### Hardening
- `dispose()` during async initialization can no longer flip status back to
  ready, emit stale updates, or act on a closed engine; a late AudioWorklet
  completion after `close()` is ignored, and queues/listeners are cleared.

## [1.1.0] — 2026-06-29

### Changed
- **FX editing is now a modal**, matching mpump's EffectEditor. Clicking *Edit*
  on a master-chain effect opens an overlay with a per-effect **SVG
  visualization** (echo taps, reverb decay tail, compressor knee, distortion
  curve, filter slope, LFO/sweep, bit-crush staircase, sidechain envelope…),
  mpump's exact controls (FREE/SYNC + division select, room/hall/plate/spring,
  SMOOTH/HARD, EXCL. DRUMS/BASS/SYNTH buttons), the Time slider hidden when
  synced, and ESC / click-outside to close. Replaces the inline expanding panel.

## [1.0.2] — 2026-06-29

### Added
- **8 classic drum machines**, imported from mpump's sample packs: CR-78, DMX,
  Drumulator, LinnDrum, TR-606, TR-707, TR-808, and TR-909. They join the
  existing kits in the drum preset list (mpumpit has no separate "Machines"
  group, so they appear inline).

### Changed
- Instrument preset lists (synth, bass, drums) are now sorted alphabetically,
  with **Default** pinned first.

## [1.0.1] — 2026-06-29

Robustness pass from a full code review — correctness and hardening, no API or
behavior changes for valid input.

### Fixed
- **No more silent master output.** The deferred audio-graph rewires behind the
  anti-clip mode and per-channel mono toggles are now tracked and cancelled, so
  rapid back-to-back changes can't race two rewires into disconnecting each
  other's nodes.
- **Filter params are clamped at the audio thread.** Cutoff / resonance / drive
  (and the other synth params) are sanitized in the worklet, so a corrupt saved
  setting or out-of-range preset can no longer drive the Moog/diode ladders
  unstable with a negative or NaN cutoff.
- **CV gate is now polyphony-aware.** The 1V/oct CV output ref-counts held notes
  (last-note priority), so releasing one of several held notes no longer drops
  the gate while others still sound.
- **Computer-keyboard octave/velocity** keys (Z/X/C/V) ignore OS key auto-repeat,
  so holding one no longer walks the value to its limit.
- AudioParam setters (drive, EQ, master boost, BPM) guard against NaN/∞ so a bad
  value can't permanently poison a node.
- Trance-gate pattern reschedule re-anchors at the gate's current level — no more
  faint click once per bar at high depth.
- A velocity-0 note can no longer leak a synth voice slot; a bitcrusher worklet
  mismatch falls back to the WaveShaper path instead of breaking the FX rebuild;
  PANIC / all-notes-off purges pending scheduled notes.
- MIDI parsing rejects a leading data byte, masks data to 7 bits, and treats
  high-rate MTC/song-position as throttled timing (no LED spam).
- Corrupt/older persisted `soundState` that isn't a plain object is ignored
  rather than fed into the engine.
- Drum-map and BPM number inputs guard against empty/NaN entry; **Reset** now
  confirms before wiping settings.

### Changed
- Knobs and sliders expose `aria-label` + `aria-valuetext` for screen readers.
- FX editor shows each effect's real default (not the slider minimum) for unset
  values like bitcrusher rate.
- Removed five AudioWorklet modules that were loaded but never instantiated
  (moog-filter, diode-filter, sync-osc, fm-osc, wavetable-osc) — poly-synth
  implements those models inline. Trims five network fetches on cold start.

## [1.0.0] — 2026-06-29

First stable release. Post-review editor hardening:

### Fixed
- Editors show each parameter's **effective default** (not the slider minimum)
  for unset values — e.g. kick PAN 0 / CLICK 0.15 / LPF bypass, synth SPREAD 25 —
  so a control no longer jumps abruptly the first time it's touched.
- Switching a drum kit now resets **every** voice, including CB2 (note 56) — which
  no kit defines — so the engine no longer keeps a stale edited voice.
- A user preset can no longer collide with a built-in name (auto-suffixed
  `" (user)"`), so saved presets stay recallable.
- A clock-only MIDI device now refreshes the **MIDI rx** diagnostic (~once per
  beat) instead of showing `rx 0` forever — without holding the activity LED solid.
- Removed the **LEN** (note-length) synth control: it only affected the unused
  scheduled-note path, so it had no effect on live input.
- Rapid **▶ Test** clicks no longer let a stale timeout cut off a newer audition.
- Loading a drum kit now sends a **complete** voice for every note, so a prior
  kit's optional params (e.g. `filterCutoff`) can't leak through the engine's
  merge — switching kits truly resets the sound.
- Drum voices expose their **per-note pan defaults** (RS 0.2, CB2 −0.25, …)
  rather than a global 0, matching the engine.

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
