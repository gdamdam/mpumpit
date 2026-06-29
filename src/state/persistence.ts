// localStorage persistence for mpumpit. Original work — AGPL-3.0-only.
//
// Persists the input preference, channel routing, presets, volumes, BPM, the
// full master FX chain (order / bypass / params) + per-part channel strips, and
// the drum-map overrides. Everything is funnelled through SoundState plus the
// router's channel map and selected input.

import type { SoundState } from "../sound/types";
import type { Part } from "../midi/types";
import { ALL_INPUTS } from "../midi/router";

// Schema version lives in the key name: a breaking change to the persisted
// shape bumps this to ".v2", so stale data is simply ignored (loadSettings
// returns null → defaults) rather than mis-deserialized. There is intentionally
// no in-place migration; settings are non-critical and rebuilt from defaults.
const STORAGE_KEY = "mpumpit.settings.v1";

export interface PersistedSettings {
  soundState: Partial<SoundState>;
  channels: Record<Part, number>;
  selectedInputId: string;
}

function storage(): Storage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null; // access can throw (privacy mode, sandboxed iframe)
  }
}

export function loadSettings(): PersistedSettings | null {
  const ls = storage();
  if (!ls) return null;
  try {
    const raw = ls.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedSettings>;
    if (!parsed || typeof parsed !== "object") return null;
    // soundState is merged into the engine on load, so reject anything that
    // isn't a plain object (a string/array/number from a corrupt or older
    // payload) instead of casting it through. SoundModule then defaults any
    // individual fields that are missing or out of range.
    const ss = parsed.soundState;
    const soundState: Partial<SoundState> =
      ss && typeof ss === "object" && !Array.isArray(ss) ? (ss as Partial<SoundState>) : {};
    return {
      soundState,
      channels: normalizeChannels(parsed.channels),
      selectedInputId: typeof parsed.selectedInputId === "string" ? parsed.selectedInputId : ALL_INPUTS,
    };
  } catch {
    return null; // corrupt payload — start fresh
  }
}

export function saveSettings(settings: PersistedSettings): void {
  const ls = storage();
  if (!ls) return;
  try {
    ls.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* quota / disabled — ignore, settings are non-critical */
  }
}

export function clearSettings(): void {
  const ls = storage();
  if (!ls) return;
  try {
    ls.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

function normalizeChannels(c: unknown): Record<Part, number> {
  const def: Record<Part, number> = { synth: 1, bass: 2, drums: 10 };
  if (!c || typeof c !== "object") return def;
  const obj = c as Record<string, unknown>;
  const out = { ...def };
  for (const part of ["synth", "bass", "drums"] as Part[]) {
    const v = obj[part];
    if (typeof v === "number" && v >= 1 && v <= 16) out[part] = Math.floor(v);
  }
  return out;
}

export { STORAGE_KEY };
