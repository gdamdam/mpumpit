/*
 * Derived from mpump (https://github.com/gdamdam) — Copyright (C) 2024-2026 gdamdam.
 * Audio-engine type definitions extracted from mpump's src/types.ts. Only the types
 * required by the audio engine (synth params, drum voices, effects) are kept; mpump's
 * sequencer / pattern / song / UI types are omitted. Licensed under the GNU Affero
 * General Public License v3.0 only. See LICENSE and NOTICE.
 */

// ── Synth params ─────────────────────────────────────────────────────────

export type OscType = "sawtooth" | "square" | "sine" | "triangle" | "pwm" | "sync" | "fm" | "wavetable";
export type FilterModel = "digital" | "mog" | "303";

export type LfoShape = "sine" | "square" | "triangle" | "sawtooth";
export type LfoTarget = "cutoff" | "pitch" | "both";
export type FilterType = "lowpass" | "highpass" | "bandpass" | "notch";

export interface SynthParams {
  oscType: OscType;
  attack: number;   // seconds (0.001–2)
  decay: number;    // seconds (0.01–2)
  sustain: number;  // level   (0–1)
  release: number;  // seconds (0.01–3)
  filterOn: boolean;
  filterType: FilterType;
  cutoff: number;   // Hz      (100–8000)
  resonance: number; // Q      (0.5–20)
  subOsc: boolean;  // sub-bass oscillator (-1 octave, sine)
  subLevel: number; // sub-bass level (0–1)
  detune: number;    // cents (-50 to +50)
  lfoOn: boolean;
  lfoSync: boolean;     // true = tempo-synced, false = free Hz
  lfoRate: number;      // Hz (0.1–20, used when lfoSync=false)
  lfoDivision: string;  // "2", "1", "1/2", "1/4", "1/8", "1/16", "1/32"
  lfoDepth: number;     // 0–1
  lfoShape: LfoShape;
  lfoTarget: LfoTarget;
  filterEnvDepth?: number; // filter envelope mod depth (0-1, default 0). Sweeps cutoff from cutoff+depth down to cutoff on each note.
  filterDecay?: number;    // independent filter envelope decay time in seconds (0 = use amp decay).
  filterDrive?: number;    // pre-filter drive (0-1, default 0). Pushes signal into filter for resonance/self-oscillation.
  filterModel?: FilterModel; // filter algorithm: digital (BiquadFilter), mog (4-pole ladder), 303 (diode)
  syncRatio?: number;     // hard sync slave ratio (1-16, default 2). Only used when oscType="sync".
  fmRatio?: number;       // FM modulator ratio (0.5-16, default 2). Only used when oscType="fm".
  fmIndex?: number;       // FM modulation index (0-100, default 5). Only used when oscType="fm".
  wavetable?: string;     // wavetable name (basic/vocal/metallic/pad/organ). Only used when oscType="wavetable".
  wavetablePos?: number;  // wavetable morph position (0-1, default 0.5). Only used when oscType="wavetable".
  unison?: number;        // voice count (1-7, default 1)
  unisonSpread?: number;  // detune spread in cents (0-50, default 0)
  noteLength?: number;    // note duration in steps (1=16th, 4=quarter, 8=half). Default 1.
  gain?: number;          // preset-level gain offset (default 1.0). Boost quieter presets to match louder ones.
}

export const LFO_DIVISIONS = ["2", "1", "1/2", "1/4", "1/8", "1/16", "1/32"] as const;

/** Convert LFO division string to Hz at given BPM. */
export function lfoDivisionToHz(division: string, bpm: number): number {
  const beatHz = bpm / 60;
  switch (division) {
    case "2":    return beatHz / 8;   // 2 bars
    case "1":    return beatHz / 4;   // 1 bar
    case "1/2":  return beatHz / 2;
    case "1/4":  return beatHz;
    case "1/8":  return beatHz * 2;
    case "1/16": return beatHz * 4;
    case "1/32": return beatHz * 8;
    default:     return beatHz;
  }
}

/** Delay divisions available for tempo-synced delay. */
export const DELAY_DIVISIONS = ["1/2", "1/4", "1/8", "1/8d", "1/16", "1/32"] as const;

/** Convert delay division string to time in seconds at given BPM. */
export function delayDivisionToSeconds(division: string, bpm: number): number {
  const beat = 60 / bpm; // quarter note duration
  switch (division) {
    case "1/2":  return beat * 2;
    case "1/4":  return beat;
    case "1/8":  return beat / 2;
    case "1/8d": return beat * 0.75; // dotted eighth
    case "1/16": return beat / 4;
    case "1/32": return beat / 8;
    default:     return beat / 4;
  }
}

export const DEFAULT_SYNTH_PARAMS: SynthParams = {
  oscType: "sawtooth",
  attack: 0.005,
  decay: 0.15,
  sustain: 0.6,
  release: 0.06,
  filterOn: true,
  filterType: "lowpass",
  cutoff: 4000,
  resonance: 4,
  subOsc: true,
  subLevel: 0.5,
  detune: 0,
  lfoOn: false,
  lfoSync: false,
  lfoRate: 2,
  lfoDivision: "1/4",
  lfoDepth: 0.5,
  lfoShape: "sine",
  lfoTarget: "cutoff",
};

// ── Drum voice params ──────────────────────────────────────────────────────

export interface DrumVoiceParams {
  tune: number;   // semitones (-24 to +24, default 0)
  decay: number;  // multiplier (0.2 to 3.0, default 1.0)
  level: number;  // volume (0 to 1, default 1.0)
  // Extended params (optional, defaults to classic behavior)
  click?: number;        // kick: attack click level (0-1, default 0.15)
  sweepDepth?: number;   // kick: pitch sweep amount (0-1, default 0.5)
  sweepRate?: number;    // kick: pitch sweep speed (0-1, default 0.5)
  noiseMix?: number;     // snare: noise vs tone balance (0=tone, 1=noise, default 0.55)
  color?: number;        // hats: brightness (-1=dark, 0=neutral, 1=bright, default 0)
  clickTune?: number;    // kick: click pitch (-1=warm/low, 0=mid, 1=bright/high, default 0)
  filterCutoff?: number; // per-voice LP filter (0=very dark, 1=bypass, default 1)
  pan?: number;          // stereo pan (-1=left, 0=center, 1=right)
}

/**
 * mpump's drum voice slots — its own ordering keyed by MIDI note number (GM-ish,
 * but NOT full General MIDI: 37=rimshot, 47=cowbell, 50=clap diverge from GM).
 * The UI editor exposes these 9 slots; the synth engine (drumSynth.DRUM_SYNTHS)
 * additionally maps note 56 to cowbell.
 */
export const DRUM_VOICES = [
  { note: 36, name: "BD" },
  { note: 37, name: "RS" },
  { note: 38, name: "SD" },
  { note: 42, name: "CH" },
  { note: 46, name: "OH" },
  { note: 47, name: "CB" },
  { note: 49, name: "CY" },
  { note: 50, name: "CP" },
  { note: 51, name: "RD" },
] as const;

export const DEFAULT_DRUM_VOICE: DrumVoiceParams = {
  tune: 0,
  decay: 1.0,
  level: 1.0,
};

// ── Effects ────────────────────────────────────────────────────────────────

export interface EffectParams {
  delay: { on: boolean; time: number; feedback: number; mix: number; sync: boolean; division: string; excludeDrums?: boolean; excludeBass?: boolean; excludeSynth?: boolean };
  distortion: { on: boolean; drive: number; excludeDrums?: boolean; excludeBass?: boolean; excludeSynth?: boolean };
  reverb: { on: boolean; decay: number; mix: number; type: string; excludeDrums?: boolean; excludeBass?: boolean; excludeSynth?: boolean };
  compressor: { on: boolean; threshold: number; ratio: number; excludeDrums?: boolean; excludeBass?: boolean; excludeSynth?: boolean };
  highpass: { on: boolean; cutoff: number; q: number; excludeDrums?: boolean; excludeBass?: boolean; excludeSynth?: boolean };
  chorus: { on: boolean; rate: number; depth: number; mix: number; excludeDrums?: boolean; excludeBass?: boolean; excludeSynth?: boolean };
  phaser: { on: boolean; rate: number; depth: number; excludeDrums?: boolean; excludeBass?: boolean; excludeSynth?: boolean };
  bitcrusher: { on: boolean; bits: number; crushRate?: number; excludeDrums?: boolean; excludeBass?: boolean; excludeSynth?: boolean };
  duck: { on: boolean; depth: number; release: number; excludeBass?: boolean; excludeSynth?: boolean };
  flanger: { on: boolean; rate: number; depth: number; feedback: number; mix: number; excludeDrums?: boolean; excludeBass?: boolean; excludeSynth?: boolean };
  tremolo: { on: boolean; rate: number; depth: number; shape: string; excludeDrums?: boolean; excludeBass?: boolean; excludeSynth?: boolean };
}

export type EffectName = keyof EffectParams;

export const DEFAULT_EFFECTS: EffectParams = {
  delay: { on: false, time: 0.3, feedback: 0.4, mix: 0.3, sync: true, division: "1/16" },
  distortion: { on: false, drive: 20 },
  reverb: { on: false, decay: 1, mix: 0.45, type: "room" },
  compressor: { on: false, threshold: -24, ratio: 4 },
  highpass: { on: false, cutoff: 200, q: 1 },
  chorus: { on: false, rate: 1.5, depth: 0.003, mix: 0.3 },
  phaser: { on: false, rate: 0.5, depth: 1000 },
  bitcrusher: { on: false, bits: 8 },
  duck: { on: false, depth: 0.85, release: 0.04 },
  flanger: { on: false, rate: 0.5, depth: 0.7, feedback: 0.7, mix: 0.5 },
  tremolo: { on: false, rate: 4, depth: 0.5, shape: "sine" },
};
