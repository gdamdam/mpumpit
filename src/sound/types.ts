// SoundModule state & FX-facade types. Original work — AGPL-3.0-only.

import type { EffectName, EffectParams, SynthParams, DrumVoiceParams } from "../engine/types";
import type { SynthPreset, DrumKitPreset } from "../engine/soundPresets";
import type { Part } from "../midi/types";

/** Target for the FX facade: the master bus or one part's channel strip. */
export type FxTarget = "master" | Part;

/**
 * mpump's master effect chain is the 11 effects below. Order is reorderable
 * (except `duck`, a kick-triggered sidechain that mpump keeps out of the
 * reorderable order). `getEffectChain("master")` reflects this honestly.
 */
export const MASTER_EFFECTS: readonly EffectName[] = [
  "compressor", "highpass", "distortion", "bitcrusher", "chorus",
  "phaser", "flanger", "delay", "reverb", "tremolo", "duck",
] as const;

/** mpump's default reorderable order (10 effects; `duck` pinned, applied separately). */
export const DEFAULT_EFFECT_ORDER: EffectName[] = [
  "compressor", "highpass", "distortion", "bitcrusher", "chorus",
  "phaser", "flanger", "delay", "reverb", "tremolo",
];

/**
 * Per-part processing is a FIXED channel strip (NOT a reorderable chain).
 * These pseudo-effect ids let the facade expose parts through the same
 * getAvailableEffects/getEffectChain methods while being honest about routing.
 */
export const CHANNEL_STRIP_EFFECTS = ["eq", "hpf", "pan", "gate"] as const;
export type StripEffectId = (typeof CHANNEL_STRIP_EFFECTS)[number];

export interface ChannelStrip {
  eq: { low: number; mid: number; high: number }; // dB, -12..+12
  hpf: { on: boolean; freq: number }; // 20..500 Hz (off => bypass)
  pan: number; // -1..+1
  gate: { on: boolean; rate: string; depth: number; shape: string }; // trance gate
}

export const DEFAULT_CHANNEL_STRIP: ChannelStrip = {
  eq: { low: 0, mid: 0, high: 0 },
  hpf: { on: false, freq: 120 },
  pan: 0,
  gate: { on: false, rate: "1/8", depth: 0.7, shape: "sine" },
};

export interface PartState {
  preset: string; // preset name (built-in or user); the starting point
  volume: number; // 0..1
  strip: ChannelStrip;
  // Live, editable instrument params (override the preset; persisted).
  params?: SynthParams; // synth & bass
  voices?: Record<number, DrumVoiceParams>; // drums — keyed by drum note
}

/** Named custom presets saved by the user (persisted alongside the built-ins). */
export interface UserPresets {
  synth: SynthPreset[];
  bass: SynthPreset[];
  drums: DrumKitPreset[];
}

/** Full serializable state owned by the SoundModule. */
export interface SoundState {
  masterVolume: number; // 0..1
  bpm: number;
  effects: EffectParams; // mpump's effect params (on / params / per-part exclude)
  effectOrder: EffectName[];
  drumMap: Record<number, number>; // incoming-note → mpump-note overrides
  parts: Record<Part, PartState>;
  userPresets: UserPresets;
}

/** One item in a chain returned by getEffectChain(). */
export interface FxChainItem {
  id: string; // EffectName for master, StripEffectId for a part
  enabled: boolean;
  reorderable: boolean;
  params: Record<string, unknown>;
}

export interface FxChain {
  target: FxTarget;
  reorderable: boolean; // whole-chain reorder capability (master: true, parts: false)
  items: FxChainItem[];
}
