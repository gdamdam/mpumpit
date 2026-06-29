// UI metadata for the per-voice drum editor. Ranges mirror mpump's DrumVoiceParams
// (see engine/types.ts comments). Original work — AGPL-3.0-only.

import type { DrumVoiceParams } from "../engine/types";
import { DRUM_VOICES } from "../engine/types";

export interface DrumKnob {
  key: keyof DrumVoiceParams;
  label: string;
  min: number;
  max: number;
  step: number;
  def: number; // effective engine default when the voice doesn't set it
}

// `def` mirrors the engine's per-voice defaults (drumSynth / DEFAULT_DRUM_VOICE),
// so an unset param shows its real starting value, not the slider minimum.
export const DRUM_PARAMS: DrumKnob[] = [
  { key: "tune", label: "TUNE", min: -24, max: 24, step: 1, def: 0 },
  { key: "decay", label: "DECAY", min: 0.2, max: 3.0, step: 0.05, def: 1.0 },
  { key: "level", label: "LEVEL", min: 0, max: 1, step: 0.01, def: 1.0 },
  { key: "pan", label: "PAN", min: -1, max: 1, step: 0.05, def: 0 },
  { key: "click", label: "CLICK", min: 0, max: 1, step: 0.01, def: 0.15 },
  { key: "clickTune", label: "CLK TUNE", min: -1, max: 1, step: 0.05, def: 0 },
  { key: "sweepDepth", label: "SWEEP", min: 0, max: 1, step: 0.01, def: 0.5 },
  { key: "sweepRate", label: "SWP RATE", min: 0, max: 1, step: 0.01, def: 0.5 },
  { key: "noiseMix", label: "NOISE", min: 0, max: 1, step: 0.01, def: 0.55 },
  { key: "color", label: "COLOR", min: -1, max: 1, step: 0.05, def: 0 },
  { key: "filterCutoff", label: "LPF", min: 0, max: 1, step: 0.01, def: 1 },
];

// Editable drum voices: mpump's 9 UI slots plus note 56, which the synth engine
// maps to a second cowbell (DRUM_SYNTHS), so the editor exposes it as CB2.
export const DRUM_VOICE_LIST: { note: number; name: string }[] = [
  ...DRUM_VOICES.map((v) => ({ note: v.note, name: v.name })),
  { note: 56, name: "CB2" },
];
