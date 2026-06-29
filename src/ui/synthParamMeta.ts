// UI metadata for a full-parity synth editor — OSCILLATOR / FILTER / LFO sections,
// plus osc-type-conditional extras. Ranges mirror mpump's SynthEditor knobs.
// Original work — AGPL-3.0-only.

import type { SynthParams, OscType } from "../engine/types";
import { LFO_DIVISIONS } from "../engine/types";

export interface SynthKnob {
  key: keyof SynthParams;
  label: string;
  min: number;
  max: number;
  step: number;
  format?: "int" | "sec" | "hz" | "pct" | "cents" | "raw";
}

export interface SynthSelect {
  key: keyof SynthParams;
  label: string;
  options: readonly string[];
}

export interface SynthToggle {
  key: keyof SynthParams;
  label: string;
}

// ── OSCILLATOR ───────────────────────────────────────────────────────────────

const OSC_TYPES: readonly OscType[] = ["sawtooth", "square", "sine", "triangle", "pwm", "sync", "fm", "wavetable"];

export const OSC_TYPE_SELECT: SynthSelect = { key: "oscType", label: "Osc", options: OSC_TYPES };

export const OSC_KNOBS: SynthKnob[] = [
  { key: "detune", label: "DET", min: -50, max: 50, step: 1, format: "cents" },
  { key: "subLevel", label: "SUB LVL", min: 0, max: 1, step: 0.01, format: "pct" },
  { key: "unison", label: "VOICES", min: 1, max: 7, step: 2, format: "int" },
  { key: "unisonSpread", label: "SPREAD", min: 0, max: 50, step: 1, format: "cents" },
  { key: "noteLength", label: "LEN", min: 1, max: 16, step: 1, format: "int" },
  { key: "gain", label: "GAIN", min: 0.5, max: 2, step: 0.01, format: "raw" },
];

export const OSC_TOGGLES: SynthToggle[] = [{ key: "subOsc", label: "SUB" }];

// Envelope knobs (part of the oscillator section).
export const ENV_KNOBS: SynthKnob[] = [
  { key: "attack", label: "ATK", min: 0.001, max: 1, step: 0.005, format: "sec" },
  { key: "decay", label: "DEC", min: 0.01, max: 1, step: 0.01, format: "sec" },
  { key: "sustain", label: "SUS", min: 0, max: 1, step: 0.01, format: "pct" },
  { key: "release", label: "REL", min: 0.01, max: 2, step: 0.01, format: "sec" },
];

// Osc-type-conditional controls — the component renders these based on oscType.
export const OSC_TYPE_EXTRAS: Partial<Record<OscType, { knobs?: SynthKnob[]; selects?: SynthSelect[] }>> = {
  sync: {
    knobs: [{ key: "syncRatio", label: "RATIO", min: 1, max: 16, step: 0.1, format: "raw" }],
  },
  fm: {
    knobs: [
      { key: "fmRatio", label: "RATIO", min: 0.5, max: 16, step: 0.1, format: "raw" },
      { key: "fmIndex", label: "INDEX", min: 0, max: 100, step: 1, format: "int" },
    ],
  },
  wavetable: {
    knobs: [{ key: "wavetablePos", label: "MORPH", min: 0, max: 1, step: 0.01, format: "pct" }],
    selects: [{ key: "wavetable", label: "Wave", options: ["basic", "vocal", "metallic", "pad", "organ"] }],
  },
};

// ── FILTER ─────────────────────────────────────────────────────────────────

export const FILTER_SELECTS: SynthSelect[] = [
  { key: "filterType", label: "Type", options: ["lowpass", "highpass", "bandpass", "notch"] },
  { key: "filterModel", label: "Model", options: ["digital", "mog", "303"] },
];

export const FILTER_TOGGLES: SynthToggle[] = [{ key: "filterOn", label: "ON" }];

export const FILTER_KNOBS: SynthKnob[] = [
  { key: "cutoff", label: "CUT", min: 100, max: 8000, step: 50, format: "hz" },
  { key: "resonance", label: "RES", min: 0.5, max: 20, step: 0.5, format: "raw" },
  { key: "filterEnvDepth", label: "ENV", min: 0, max: 1, step: 0.01, format: "pct" },
  { key: "filterDecay", label: "DEC", min: 0, max: 2, step: 0.01, format: "sec" },
  { key: "filterDrive", label: "DRV", min: 0, max: 1, step: 0.01, format: "pct" },
];

// ── LFO ──────────────────────────────────────────────────────────────────────

export const LFO_SELECTS: SynthSelect[] = [
  { key: "lfoShape", label: "Shape", options: ["sine", "square", "triangle", "sawtooth"] },
  { key: "lfoTarget", label: "Target", options: ["cutoff", "pitch", "both"] },
  { key: "lfoDivision", label: "Div", options: LFO_DIVISIONS },
];

export const LFO_TOGGLES: SynthToggle[] = [
  { key: "lfoOn", label: "ON" },
  { key: "lfoSync", label: "Sync" },
];

export const LFO_KNOBS: SynthKnob[] = [
  { key: "lfoRate", label: "RATE", min: 0.1, max: 20, step: 0.1, format: "hz" },
  { key: "lfoDepth", label: "DEPTH", min: 0, max: 1, step: 0.01, format: "pct" },
];

// ── Sections ───────────────────────────────────────────────────────────────

export interface SynthSection {
  title: string;
  knobs?: SynthKnob[];
  selects?: SynthSelect[];
  toggles?: SynthToggle[];
}

export const SYNTH_SECTIONS: SynthSection[] = [
  {
    title: "OSCILLATOR",
    knobs: [...OSC_KNOBS, ...ENV_KNOBS],
    selects: [OSC_TYPE_SELECT],
    toggles: OSC_TOGGLES,
  },
  {
    title: "FILTER",
    knobs: FILTER_KNOBS,
    selects: FILTER_SELECTS,
    toggles: FILTER_TOGGLES,
  },
  {
    title: "LFO",
    knobs: LFO_KNOBS,
    selects: LFO_SELECTS,
    toggles: LFO_TOGGLES,
  },
];
