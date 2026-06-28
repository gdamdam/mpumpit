// UI metadata for the master effects — the "most important" params per effect,
// plus wet/dry and tempo-sync flags, for progressive disclosure. Ranges mirror
// mpump's EffectEditor sliders. Original work — AGPL-3.0-only.

import type { EffectName } from "../engine/types";
import { DELAY_DIVISIONS } from "../engine/types";

export interface FxParamMeta {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
}

export interface FxSelectMeta {
  key: string;
  label: string;
  options: readonly string[];
}

export interface FxMeta {
  label: string; // short silkscreen label
  full: string; // full name
  params: FxParamMeta[];
  selects?: FxSelectMeta[];
  toggles?: { key: string; label: string }[];
  wet?: string; // param key that is the wet/dry mix
  tempo?: boolean; // has a tempo-synced parameter
}

export const FX_META: Record<EffectName, FxMeta> = {
  compressor: {
    label: "CMP", full: "Compressor",
    params: [
      { key: "threshold", label: "Thresh", min: -60, max: 0, step: 1 },
      { key: "ratio", label: "Ratio", min: 1, max: 20, step: 0.5 },
    ],
  },
  highpass: {
    label: "HPF", full: "High-pass",
    params: [
      { key: "cutoff", label: "Cutoff", min: 20, max: 2000, step: 1 },
      { key: "q", label: "Q", min: 0.5, max: 15, step: 0.1 },
    ],
  },
  distortion: {
    label: "DRV", full: "Distortion",
    params: [{ key: "drive", label: "Drive", min: 1, max: 100, step: 1 }],
  },
  bitcrusher: {
    label: "CRSH", full: "Bitcrusher",
    params: [
      { key: "bits", label: "Bits", min: 2, max: 16, step: 1 },
      { key: "crushRate", label: "Rate", min: 100, max: 44100, step: 100 },
    ],
  },
  chorus: {
    label: "CHR", full: "Chorus",
    params: [
      { key: "rate", label: "Rate", min: 0.1, max: 10, step: 0.1 },
      { key: "depth", label: "Depth", min: 0.001, max: 0.01, step: 0.0005 },
    ],
    wet: "mix",
  },
  phaser: {
    label: "PHS", full: "Phaser",
    params: [
      { key: "rate", label: "Rate", min: 0.1, max: 5, step: 0.1 },
      { key: "depth", label: "Depth", min: 100, max: 3000, step: 50 },
    ],
  },
  flanger: {
    label: "FLG", full: "Flanger",
    params: [
      { key: "rate", label: "Rate", min: 0.1, max: 5, step: 0.1 },
      { key: "depth", label: "Depth", min: 0, max: 1, step: 0.01 },
      { key: "feedback", label: "Fbk", min: 0, max: 0.95, step: 0.01 },
    ],
    wet: "mix",
  },
  delay: {
    label: "DLY", full: "Delay",
    params: [
      { key: "time", label: "Time", min: 0.05, max: 1.5, step: 0.01 },
      { key: "feedback", label: "Fbk", min: 0, max: 0.9, step: 0.01 },
    ],
    selects: [{ key: "division", label: "Div", options: DELAY_DIVISIONS }],
    toggles: [{ key: "sync", label: "Sync" }],
    wet: "mix",
    tempo: true,
  },
  reverb: {
    label: "REV", full: "Reverb",
    params: [{ key: "decay", label: "Decay", min: 0.5, max: 5, step: 0.1 }],
    selects: [{ key: "type", label: "Type", options: ["room", "hall", "plate"] }],
    wet: "mix",
  },
  tremolo: {
    label: "TRM", full: "Tremolo",
    params: [
      { key: "rate", label: "Rate", min: 0.5, max: 15, step: 0.1 },
      { key: "depth", label: "Depth", min: 0, max: 1, step: 0.01 },
    ],
    selects: [{ key: "shape", label: "Shape", options: ["sine", "square"] }],
  },
  duck: {
    label: "DUCK", full: "Sidechain Duck",
    params: [
      { key: "depth", label: "Depth", min: 0.1, max: 1, step: 0.05 },
      { key: "release", label: "Release", min: 0.01, max: 0.3, step: 0.01 },
    ],
  },
};

export const WET_LABEL = "Mix";
