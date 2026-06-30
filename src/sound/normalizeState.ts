// Defensive normalization of persisted SoundState. localStorage can hold any
// JSON-compatible value (corrupt, hand-edited, or from an older/newer build), so
// every nested field is validated against the defaults at the persistence /
// SoundModule boundary BEFORE it reaches mergeState() or the engine. Malformed
// fields are defaulted individually rather than discarding all valid settings,
// and nothing here throws on bad input. Original work — AGPL-3.0-only.

import type { EffectName, EffectParams, SynthParams, DrumVoiceParams } from "../engine/types";
import { DEFAULT_EFFECTS, DEFAULT_SYNTH_PARAMS, LFO_DIVISIONS } from "../engine/types";
import {
  MASTER_EFFECTS, DEFAULT_EFFECT_ORDER, DEFAULT_CHANNEL_STRIP, DEFAULT_MASTER,
  type SoundState, type PartState, type ChannelStrip, type UserPresets, type MasterSettings,
} from "./types";
import type { Part } from "../midi/types";
import type { SynthPreset, DrumKitPreset } from "../engine/soundPresets";

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
/** A finite number clamped to [lo, hi], else the default. */
function numOr(v: unknown, def: number, lo: number, hi: number): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : def;
}
/** A finite number rounded to an integer and clamped to [lo, hi], else the default. */
function intOr(v: unknown, def: number, lo: number, hi: number): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : def;
}
/** A string belonging to `allowed`, else the default. */
function enumOr<T extends string>(v: unknown, allowed: readonly T[], def: T): T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : def;
}
function boolOr(v: unknown, def: boolean): boolean {
  return typeof v === "boolean" ? v : def;
}

const REORDERABLE = new Set<EffectName>(DEFAULT_EFFECT_ORDER);

// Allowed enum values for SynthParams string fields. Mirror engine/types.ts;
// kept local so normalization doesn't couple to UI metadata.
const OSC_TYPES = ["sawtooth", "square", "sine", "triangle", "pwm", "sync", "fm", "wavetable"] as const;
const FILTER_TYPES = ["lowpass", "highpass", "bandpass", "notch"] as const;
const FILTER_MODELS = ["digital", "mog", "303"] as const;
const LFO_SHAPES = ["sine", "square", "triangle", "sawtooth"] as const;
const LFO_TARGETS = ["cutoff", "pitch", "both"] as const;
const WAVETABLES = ["basic", "vocal", "metallic", "pad", "organ"] as const;

/**
 * Fully validate persisted/user-supplied SynthParams. Every REQUIRED field is
 * range-clamped (numbers) or enum/type-checked, defaulting from
 * DEFAULT_SYNTH_PARAMS individually so the result is always a complete, valid
 * param set the engine can apply directly. OPTIONAL fields are validated only
 * when present (kept absent otherwise, so the engine applies its own default).
 * Ranges follow the engine's documented bounds in engine/types.ts. Never throws.
 */
export function normalizeSynthParams(raw: unknown): SynthParams {
  const d = DEFAULT_SYNTH_PARAMS;
  if (!isObj(raw)) return { ...d };
  const out: SynthParams = {
    oscType: enumOr(raw.oscType, OSC_TYPES, d.oscType),
    attack: numOr(raw.attack, d.attack, 0.001, 2),
    decay: numOr(raw.decay, d.decay, 0.01, 2),
    sustain: numOr(raw.sustain, d.sustain, 0, 1),
    release: numOr(raw.release, d.release, 0.01, 3),
    filterOn: boolOr(raw.filterOn, d.filterOn),
    filterType: enumOr(raw.filterType, FILTER_TYPES, d.filterType),
    cutoff: numOr(raw.cutoff, d.cutoff, 100, 8000),
    resonance: numOr(raw.resonance, d.resonance, 0.5, 20),
    subOsc: boolOr(raw.subOsc, d.subOsc),
    subLevel: numOr(raw.subLevel, d.subLevel, 0, 1),
    detune: numOr(raw.detune, d.detune, -50, 50),
    lfoOn: boolOr(raw.lfoOn, d.lfoOn),
    lfoSync: boolOr(raw.lfoSync, d.lfoSync),
    lfoRate: numOr(raw.lfoRate, d.lfoRate, 0.1, 20),
    lfoDivision: enumOr(raw.lfoDivision, LFO_DIVISIONS, d.lfoDivision),
    lfoDepth: numOr(raw.lfoDepth, d.lfoDepth, 0, 1),
    lfoShape: enumOr(raw.lfoShape, LFO_SHAPES, d.lfoShape),
    lfoTarget: enumOr(raw.lfoTarget, LFO_TARGETS, d.lfoTarget),
  };
  // Optional fields: validate only when present so absence keeps engine defaults.
  if ("filterEnvDepth" in raw) out.filterEnvDepth = numOr(raw.filterEnvDepth, 0, 0, 1);
  if ("filterDecay" in raw) out.filterDecay = numOr(raw.filterDecay, 0, 0, 2);
  if ("filterDrive" in raw) out.filterDrive = numOr(raw.filterDrive, 0, 0, 1);
  if ("syncRatio" in raw) out.syncRatio = numOr(raw.syncRatio, 2, 1, 16);
  if ("fmRatio" in raw) out.fmRatio = numOr(raw.fmRatio, 2, 0.5, 16);
  if ("fmIndex" in raw) out.fmIndex = intOr(raw.fmIndex, 5, 0, 100);
  if ("wavetablePos" in raw) out.wavetablePos = numOr(raw.wavetablePos, 0.5, 0, 1);
  if ("unison" in raw) out.unison = intOr(raw.unison, 1, 1, 7);
  if ("unisonSpread" in raw) out.unisonSpread = numOr(raw.unisonSpread, 0, 0, 50);
  if ("noteLength" in raw) out.noteLength = intOr(raw.noteLength, 1, 1, 64);
  if ("gain" in raw) out.gain = numOr(raw.gain, 1, 0.5, 2);
  // Optional enums: keep only a valid value; drop anything else (engine defaults).
  if (typeof raw.filterModel === "string" && (FILTER_MODELS as readonly string[]).includes(raw.filterModel))
    out.filterModel = raw.filterModel as SynthParams["filterModel"];
  if (typeof raw.wavetable === "string" && (WAVETABLES as readonly string[]).includes(raw.wavetable))
    out.wavetable = raw.wavetable;
  return out;
}

/** Validate one drum voice: required tune/decay/level always set (clamped or
 *  defaulted); optional fields validated only when present. Unknown keys are
 *  dropped so no garbage reaches the engine. */
function normalizeDrumVoice(raw: Record<string, unknown>): DrumVoiceParams {
  const out: DrumVoiceParams = {
    tune: numOr(raw.tune, 0, -24, 24),
    decay: numOr(raw.decay, 1.0, 0.2, 3.0),
    level: numOr(raw.level, 1.0, 0, 1),
  };
  if ("click" in raw) out.click = numOr(raw.click, 0.15, 0, 1);
  if ("sweepDepth" in raw) out.sweepDepth = numOr(raw.sweepDepth, 0.5, 0, 1);
  if ("sweepRate" in raw) out.sweepRate = numOr(raw.sweepRate, 0.5, 0, 1);
  if ("noiseMix" in raw) out.noiseMix = numOr(raw.noiseMix, 0.55, 0, 1);
  if ("color" in raw) out.color = numOr(raw.color, 0, -1, 1);
  if ("clickTune" in raw) out.clickTune = numOr(raw.clickTune, 0, -1, 1);
  if ("filterCutoff" in raw) out.filterCutoff = numOr(raw.filterCutoff, 1, 0, 1);
  if ("pan" in raw) out.pan = numOr(raw.pan, 0, -1, 1);
  return out;
}

/** Per-effect params: start from the default, copy only valid FLAT primitive
 *  values (drop nested/null garbage that would crash FX rendering), force `on`
 *  to a boolean. A null or non-object effect keeps its full default. */
function normalizeEffects(raw: unknown): EffectParams {
  const out = structuredClone(DEFAULT_EFFECTS);
  if (!isObj(raw)) return out;
  for (const name of MASTER_EFFECTS) {
    const pv = raw[name];
    if (!isObj(pv)) continue; // null / primitive / array → keep default effect
    const target = out[name] as Record<string, unknown>;
    for (const [k, v] of Object.entries(pv)) {
      if (v === null) continue;
      const t = typeof v;
      if (t === "boolean" || t === "string" || (t === "number" && Number.isFinite(v))) {
        target[k] = v;
      }
    }
    target.on = !!target.on;
  }
  return out;
}

/** A complete, duplicate-free reorderable order: keep known names in their saved
 *  position, drop unknown/duplicate/`duck`, then append any missing effect once. */
function normalizeEffectOrder(raw: unknown): EffectName[] {
  const seen = new Set<EffectName>();
  const order: EffectName[] = [];
  if (Array.isArray(raw)) {
    for (const v of raw) {
      if (typeof v === "string" && REORDERABLE.has(v as EffectName) && !seen.has(v as EffectName)) {
        seen.add(v as EffectName);
        order.push(v as EffectName);
      }
    }
  }
  for (const name of DEFAULT_EFFECT_ORDER) if (!seen.has(name)) order.push(name);
  return order;
}

function normalizeStrip(raw: Record<string, unknown>): ChannelStrip {
  const d = DEFAULT_CHANNEL_STRIP;
  const eq = isObj(raw.eq) ? raw.eq : {};
  const hpf = isObj(raw.hpf) ? raw.hpf : {};
  const gate = isObj(raw.gate) ? raw.gate : {};
  return {
    eq: {
      low: numOr(eq.low, d.eq.low, -24, 24),
      mid: numOr(eq.mid, d.eq.mid, -24, 24),
      high: numOr(eq.high, d.eq.high, -24, 24),
    },
    hpf: { on: typeof hpf.on === "boolean" ? hpf.on : d.hpf.on, freq: numOr(hpf.freq, d.hpf.freq, 20, 20000) },
    pan: numOr(raw.pan, d.pan, -1, 1),
    gate: {
      on: typeof gate.on === "boolean" ? gate.on : d.gate.on,
      rate: typeof gate.rate === "string" ? gate.rate : d.gate.rate,
      depth: numOr(gate.depth, d.gate.depth, 0, 1),
      shape: typeof gate.shape === "string" ? gate.shape : d.gate.shape,
    },
  };
}

function normalizeVoices(raw: Record<string, unknown>): Record<number, DrumVoiceParams> {
  const out: Record<number, DrumVoiceParams> = {};
  for (const [k, v] of Object.entries(raw)) {
    const note = Number(k);
    if (Number.isInteger(note) && note >= 0 && note <= 127 && isObj(v)) out[note] = normalizeDrumVoice(v);
  }
  return out;
}

function normalizePart(raw: unknown): Partial<PartState> | undefined {
  if (!isObj(raw)) return undefined;
  const out: Partial<PartState> = {};
  if (typeof raw.preset === "string") out.preset = raw.preset;
  if (typeof raw.volume === "number" && Number.isFinite(raw.volume)) out.volume = clamp01(raw.volume);
  if (isObj(raw.strip)) out.strip = normalizeStrip(raw.strip);
  if (isObj(raw.params)) out.params = normalizeSynthParams(raw.params); // fully validated; hydrate() backfills if the field is absent
  if (isObj(raw.voices)) out.voices = normalizeVoices(raw.voices);
  return out;
}

function normalizeDrumMap(raw: unknown): Record<number, number> {
  const out: Record<number, number> = {};
  if (!isObj(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    const from = Number(k);
    if (Number.isInteger(from) && typeof v === "number" && Number.isFinite(v)) out[from] = Math.trunc(v);
  }
  return out;
}

/** Master output stage: each field clamped to its engine range; limiter mode
 *  validated against the allowed enum. Missing/garbage fields keep the default. */
function normalizeMaster(raw: unknown): MasterSettings {
  const d = DEFAULT_MASTER;
  if (!isObj(raw)) return structuredClone(d);
  const eq = isObj(raw.eq) ? raw.eq : {};
  const mode = raw.limiterMode;
  return {
    eq: {
      low: numOr(eq.low, d.eq.low, -12, 12),
      mid: numOr(eq.mid, d.eq.mid, -12, 12),
      high: numOr(eq.high, d.eq.high, -12, 12),
    },
    lowCut: numOr(raw.lowCut, d.lowCut, 0, 500),
    multibandOn: typeof raw.multibandOn === "boolean" ? raw.multibandOn : d.multibandOn,
    multibandAmount: numOr(raw.multibandAmount, d.multibandAmount, 0, 1),
    limiterMode: mode === "off" || mode === "limiter" || mode === "hybrid" ? mode : d.limiterMode,
    drive: numOr(raw.drive, d.drive, -6, 12),
    boost: numOr(raw.boost, d.boost, 0.5, 3),
    width: numOr(raw.width, d.width, 0, 1),
    drumsThroughFx: typeof raw.drumsThroughFx === "boolean" ? raw.drumsThroughFx : d.drumsThroughFx,
  };
}

/** Synth/bass user presets: a preset MUST have a string name (else rejected);
 *  its params are fully validated/defaulted so a malformed user preset can't
 *  send garbage to the engine when selected. genres/group kept only if strings. */
function normalizeSynthPresets(raw: unknown): SynthPreset[] {
  if (!Array.isArray(raw)) return [];
  const out: SynthPreset[] = [];
  for (const p of raw) {
    if (!isObj(p) || typeof p.name !== "string") continue;
    const preset: SynthPreset = { name: p.name, params: normalizeSynthParams(p.params) };
    if (typeof p.genres === "string") preset.genres = p.genres;
    if (typeof p.group === "string") preset.group = p.group;
    out.push(preset);
  }
  return out;
}

/** Drum-kit user presets: a preset MUST have a string name (else rejected).
 *  Missing/garbage `voices` becomes {} — kitVoices() then fills every drum note
 *  with defaults, so a voiceless kit loads as an all-default kit instead of
 *  crashing on `kit.voices[note]`. Present voices are field-validated. */
function normalizeDrumKitPresets(raw: unknown): DrumKitPreset[] {
  if (!Array.isArray(raw)) return [];
  const out: DrumKitPreset[] = [];
  for (const p of raw) {
    if (!isObj(p) || typeof p.name !== "string") continue;
    const preset: DrumKitPreset = { name: p.name, voices: isObj(p.voices) ? normalizeVoices(p.voices) : {} };
    if (typeof p.genres === "string") preset.genres = p.genres;
    out.push(preset);
  }
  return out;
}

function normalizeUserPresets(raw: unknown): UserPresets {
  if (!isObj(raw)) return { synth: [], bass: [], drums: [] };
  return {
    synth: normalizeSynthPresets(raw.synth),
    bass: normalizeSynthPresets(raw.bass),
    drums: normalizeDrumKitPresets(raw.drums),
  };
}

/**
 * Coerce arbitrary persisted data into a valid Partial<SoundState>. Returns only
 * the fields that were present (so mergeState fills the rest from defaults),
 * each individually validated. Accepts valid older/partial state; never throws.
 */
export function normalizeSoundState(raw: unknown): Partial<SoundState> {
  if (!isObj(raw)) return {};
  const out: Partial<SoundState> = {};
  if (typeof raw.masterVolume === "number" && Number.isFinite(raw.masterVolume)) out.masterVolume = clamp01(raw.masterVolume);
  if (typeof raw.bpm === "number" && Number.isFinite(raw.bpm)) out.bpm = Math.max(20, Math.min(300, raw.bpm));
  if ("effects" in raw) out.effects = normalizeEffects(raw.effects);
  if ("effectOrder" in raw) out.effectOrder = normalizeEffectOrder(raw.effectOrder);
  if ("master" in raw) out.master = normalizeMaster(raw.master);
  if ("drumMap" in raw) out.drumMap = normalizeDrumMap(raw.drumMap);
  if (isObj(raw.parts)) {
    const parts: Record<string, Partial<PartState>> = {};
    for (const part of ["synth", "bass", "drums"] as Part[]) {
      const np = normalizePart((raw.parts as Record<string, unknown>)[part]);
      if (np) parts[part] = np;
    }
    if (Object.keys(parts).length) out.parts = parts as unknown as SoundState["parts"];
  }
  if ("userPresets" in raw) out.userPresets = normalizeUserPresets(raw.userPresets);
  return out;
}
