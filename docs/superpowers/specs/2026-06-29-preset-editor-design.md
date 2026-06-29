# mpumpit — Preset/Sound Editor (design)

Date: 2026-06-29 · Status: approved, ready to implement

## Goal

Let the player edit the synth/bass/drum sound, not just pick a preset. Presets
remain the default starting point; an **Edit** button opens a full-screen editor
with **full parity** over the engine's parameters, plus visual feedback (ADSR
curve, filter response, LFO shape, waveform), in the spirit of mpump's synth
view. Edits are a **live override** that persists, and can be **saved as** named
user presets.

## Decisions (from brainstorm)

- **Edit model:** live override + Save as. Pick a preset → its values seed the
  live params; edits modify the live sound and persist; "Save as…" stores named
  user presets (localStorage). Re-selecting any preset reloads it (discards
  edits). A ✎ marker shows when live params differ from the named preset.
- **Depth:** full parity — every `SynthParams` / `DrumVoiceParams` field.
- **Layout:** full-screen editor view that swaps the faceplate body; ← Back
  returns. Mixer hidden while editing. One editor at a time.

## State model (SoundModule / SoundState)

Today a part stores `{ preset, volume, strip }`. Add the live instrument params:

- `parts.synth.params: SynthParams`, `parts.bass.params: SynthParams`
- `parts.drums.voices: Record<number, DrumVoiceParams>` (keyed by drum note)
- top-level `userPresets: { synth: SynthPreset[]; bass: SynthPreset[]; drums: DrumKitPreset[] }`

`setPreset(part, name)` now resolves the preset (built-in or user) and copies its
`params`/`voices` into state, then applies. Editing mutates `params`/`voices`.
`mergeState` gains defaults for the new fields (back-compat: old saved state
without `params` falls back to the named preset's params on load). All persisted.

## Facade API additions (SoundModule)

- `setSynthParam(part, patch: Partial<SynthParams>)` → merge into `params`, call `engine.setSynthParams(ch, params)`.
- `getSynthParams(part): SynthParams`
- `setDrumVoiceParam(note, patch: Partial<DrumVoiceParams>)` → merge, `engine.setDrumVoice(note, …)`.
- `getDrumVoices(): Record<number, DrumVoiceParams>`
- `getPresetNames(part)` returns built-ins + user (grouped).
- `saveUserPreset(part, name)` / `deleteUserPreset(part, name)` (persisted).
- `isPartModified(part): boolean` (live params differ from named preset).
- `auditionNote(part)` — trigger a test note (synth/bass: middle C; drums: selected voice) via the router's direct path so it shares ownership.

## Parameters (full parity, ranges from mpump's SynthEditor)

**Synth/bass — OSCILLATOR:** oscType (saw/square/sine/triangle/pwm/sync/fm/wavetable, with waveform icons); per type: sync→RATIO(1–16); fm→RATIO(0.5–16)+INDEX(0–100); wavetable→wavetable name + MORPH(0–1). ENV: ATK(0.001–1), DEC(0.01–1), SUS(0–1), REL(0.01–2); DETUNE(−50…50); VOICES/unison(1–7 step 2)+spread(0–50); sub on + LVL(0–1); noteLength(1–16); gain(0.5–2).

**FILTER:** on toggle; type (LPF/HPF/BPF/NOTCH); model (DIG/MOG/303, with response glyphs); CUT(100–8000), RES(0.5–20), ENV depth(0–1), filterDecay(0–2), DRV(0–1).

**LFO:** on toggle; shape (sine/square/triangle/sawtooth); target (cutoff/pitch/both); sync toggle → DIV (DELAY_DIVISIONS) else RATE(0.1–20); DEPTH(0–1).

**Drums — per voice** (BD/RS/SD/CH/OH/CB/CY/CP/RD + 56): tune(−24…24), decay(0.2–3.0), level(0–1), pan(−1…1), click(0–1), clickTune(−1…1), sweepDepth(0–1), sweepRate(0–1), noiseMix(0–1), color(−1…1), filterCutoff(0–1). Metadata in `synthParamMeta.ts` / `drumParamMeta.ts`.

## Visualizations (ported from mpump, recolored amber)

- **AdsrCurve** — SVG filled envelope (4 proportional segments, dashed phase markers), live from A/D/S/R.
- **FilterCurve** — log-frequency response polyline + cutoff marker, per filter type, resonance peak.
- **FilterModelIcon** / **OscIcon** — small glyphs for model + waveform buttons.
- **LfoCurve** — shape polyline (static; no animation, per the no-glow/calm ethos).

## UI components / files

- `src/ui/views/EditorView.tsx` — full-screen wrapper: header (← Back, "<PART> editor", preset select w/ User group, Save as…, Delete, Reset, ✎), routes to SynthEditor or DrumEditor.
- `src/ui/components/SynthEditor.tsx` — OSC/FILTER/LFO sections, Knobs, curves, ▶ test note.
- `src/ui/components/DrumEditor.tsx` — voice picker + that voice's Knobs + ▶ test.
- `src/ui/components/Knob.tsx` — rotary-styled control (range input + CSS), label + value.
- `src/ui/synthParamMeta.ts`, `src/ui/drumParamMeta.ts` — param descriptors/ranges.
- App: `editing: Part | null` state; Edit button per row; render EditorView when set.
- CSS for editor/knobs/curves in `styles.css`.

## Testing

- SoundModule: `setSynthParam`/`setDrumVoiceParam` reach the engine; `setPreset`
  replaces params/voices; `isPartModified`; `saveUserPreset`/`deleteUserPreset`;
  persistence round-trip incl. params/voices/userPresets; back-compat load.
- App/EditorView: Edit opens the view, Back returns, a control change calls the
  engine, Save as adds to the selector, audition triggers a note.

## Out of scope

Per-step modulation, macros, MIDI-learn, preset import/export files.
