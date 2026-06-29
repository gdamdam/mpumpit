// Defensive normalization of persisted SoundState. localStorage can hold any
// JSON-compatible value (corrupt, hand-edited, or from an older/newer build), so
// every nested field is validated against the defaults at the persistence /
// SoundModule boundary BEFORE it reaches mergeState() or the engine. Malformed
// fields are defaulted individually rather than discarding all valid settings,
// and nothing here throws on bad input. Original work — AGPL-3.0-only.

import type { EffectName, EffectParams, SynthParams, DrumVoiceParams } from "../engine/types";
import { DEFAULT_EFFECTS } from "../engine/types";
import {
  MASTER_EFFECTS, DEFAULT_EFFECT_ORDER, DEFAULT_CHANNEL_STRIP,
  type SoundState, type PartState, type ChannelStrip, type UserPresets,
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

const REORDERABLE = new Set<EffectName>(DEFAULT_EFFECT_ORDER);

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
    if (Number.isInteger(note) && note >= 0 && note <= 127 && isObj(v)) out[note] = v as unknown as DrumVoiceParams;
  }
  return out;
}

function normalizePart(raw: unknown): Partial<PartState> | undefined {
  if (!isObj(raw)) return undefined;
  const out: Partial<PartState> = {};
  if (typeof raw.preset === "string") out.preset = raw.preset;
  if (typeof raw.volume === "number" && Number.isFinite(raw.volume)) out.volume = clamp01(raw.volume);
  if (isObj(raw.strip)) out.strip = normalizeStrip(raw.strip);
  if (isObj(raw.params)) out.params = raw.params as unknown as SynthParams; // shape-checked; hydrate() backfills if dropped
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

function normalizeUserPresets(raw: unknown): UserPresets {
  const pick = (v: unknown) =>
    Array.isArray(v) ? v.filter((p) => isObj(p) && typeof (p as { name?: unknown }).name === "string") : [];
  if (!isObj(raw)) return { synth: [], bass: [], drums: [] };
  return {
    synth: pick(raw.synth) as SynthPreset[],
    bass: pick(raw.bass) as SynthPreset[],
    drums: pick(raw.drums) as DrumKitPreset[],
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
