import { describe, it, expect } from "vitest";
import { normalizeSoundState, normalizeSynthParams } from "../normalizeState";
import { DEFAULT_SYNTH_PARAMS } from "../../engine/types";

describe("normalizeSynthParams", () => {
  it("returns full defaults for non-object input", () => {
    expect(normalizeSynthParams(undefined)).toEqual({ ...DEFAULT_SYNTH_PARAMS });
    expect(normalizeSynthParams("garbage")).toEqual({ ...DEFAULT_SYNTH_PARAMS });
    expect(normalizeSynthParams(null)).toEqual({ ...DEFAULT_SYNTH_PARAMS });
  });

  it("keeps valid values untouched", () => {
    const valid = { ...DEFAULT_SYNTH_PARAMS, oscType: "square", cutoff: 2800, resonance: 5 } as const;
    expect(normalizeSynthParams(valid)).toMatchObject({ oscType: "square", cutoff: 2800, resonance: 5 });
  });

  it("backfills every missing required field from defaults", () => {
    const out = normalizeSynthParams({ cutoff: 3000 });
    expect(out.cutoff).toBe(3000);
    expect(out.oscType).toBe(DEFAULT_SYNTH_PARAMS.oscType);
    expect(out.attack).toBe(DEFAULT_SYNTH_PARAMS.attack);
    expect(out.lfoDivision).toBe(DEFAULT_SYNTH_PARAMS.lfoDivision);
    // Result is a complete param set — no undefined required fields.
    for (const k of Object.keys(DEFAULT_SYNTH_PARAMS) as (keyof typeof DEFAULT_SYNTH_PARAMS)[]) {
      expect(out[k]).not.toBeUndefined();
    }
  });

  it("clamps out-of-range numbers and defaults wrong types", () => {
    const out = normalizeSynthParams({
      cutoff: 999999,      // above max → clamp to 8000
      attack: -5,          // below min → clamp to 0.001
      sustain: "loud",     // wrong type → default
      resonance: NaN,      // non-finite → default
      detune: 9000,        // → clamp to 50
    });
    expect(out.cutoff).toBe(8000);
    expect(out.attack).toBe(0.001);
    expect(out.sustain).toBe(DEFAULT_SYNTH_PARAMS.sustain);
    expect(out.resonance).toBe(DEFAULT_SYNTH_PARAMS.resonance);
    expect(out.detune).toBe(50);
  });

  it("defaults invalid enum fields", () => {
    const out = normalizeSynthParams({ oscType: "banana", filterType: 7, lfoShape: null, lfoTarget: "nowhere" });
    expect(out.oscType).toBe(DEFAULT_SYNTH_PARAMS.oscType);
    expect(out.filterType).toBe(DEFAULT_SYNTH_PARAMS.filterType);
    expect(out.lfoShape).toBe(DEFAULT_SYNTH_PARAMS.lfoShape);
    expect(out.lfoTarget).toBe(DEFAULT_SYNTH_PARAMS.lfoTarget);
  });

  it("coerces non-boolean toggles", () => {
    const out = normalizeSynthParams({ filterOn: "yes", subOsc: 0, lfoOn: 1 });
    expect(out.filterOn).toBe(DEFAULT_SYNTH_PARAMS.filterOn);
    expect(out.subOsc).toBe(DEFAULT_SYNTH_PARAMS.subOsc);
    expect(out.lfoOn).toBe(DEFAULT_SYNTH_PARAMS.lfoOn);
  });

  it("validates optional fields only when present", () => {
    const out = normalizeSynthParams({ filterModel: "mog", fmIndex: 999, unison: 4.7, wavetable: "nope" });
    expect(out.filterModel).toBe("mog");          // valid → kept
    expect(out.fmIndex).toBe(100);                // clamped to max
    expect(out.unison).toBe(5);                    // rounded, within 1..7
    expect(out.wavetable).toBeUndefined();         // invalid optional enum → dropped
    expect(out.filterEnvDepth).toBeUndefined();    // absent optional → stays absent
  });
});

describe("normalizeSoundState — persisted params validation (task 2)", () => {
  it("validates a part's malformed params instead of passing them through", () => {
    const s = normalizeSoundState({
      parts: { synth: { preset: "X", volume: 0.5, params: { cutoff: -1, oscType: "evil" } } },
    });
    const params = s.parts!.synth!.params!;
    expect(params.cutoff).toBe(100);                          // clamped to min
    expect(params.oscType).toBe(DEFAULT_SYNTH_PARAMS.oscType); // bad enum defaulted
    expect(params.attack).toBe(DEFAULT_SYNTH_PARAMS.attack);   // missing backfilled
  });

  it("leaves params unset when raw.params is not an object (hydrate backfills)", () => {
    const s = normalizeSoundState({ parts: { synth: { preset: "X", volume: 0.5, params: "garbage" } } });
    expect(s.parts!.synth!.params).toBeUndefined();
  });
});

describe("normalizeSoundState — malformed user presets (task 3)", () => {
  it("rejects presets without a string name and validates kept ones", () => {
    const s = normalizeSoundState({
      userPresets: {
        synth: [
          { name: "Good", params: { cutoff: 99999 } }, // kept, params clamped
          { params: { cutoff: 1000 } },                // no name → rejected
          "garbage",                                    // not an object → rejected
        ],
        bass: "not an array",
        drums: [],
      },
    });
    expect(s.userPresets!.synth).toHaveLength(1);
    expect(s.userPresets!.synth[0].name).toBe("Good");
    expect(s.userPresets!.synth[0].params.cutoff).toBe(8000); // clamped
    expect(s.userPresets!.bass).toEqual([]);                  // non-array → []
  });

  it("defaults missing/garbage drum-kit voices to an object (never crashes kitVoices)", () => {
    const s = normalizeSoundState({
      userPresets: {
        synth: [],
        bass: [],
        drums: [
          { name: "No Voices" },                              // missing voices
          { name: "Bad Voices", voices: "nope" },             // non-object voices
          { name: "Partial", voices: { "36": { tune: 99 } } },// valid note, out-of-range tune
        ],
      },
    });
    const kits = s.userPresets!.drums;
    expect(kits).toHaveLength(3);
    expect(kits[0].voices).toEqual({});                       // missing → {}
    expect(kits[1].voices).toEqual({});                       // garbage → {}
    expect(kits[2].voices[36].tune).toBe(24);                 // clamped to max
  });

  it("validates drum voice fields and drops unknown ones", () => {
    const s = normalizeSoundState({
      parts: { drums: { preset: "X", volume: 0.5, voices: { "36": { tune: "x", level: 2, junk: 1, pan: -5 } } } },
    });
    const v = s.parts!.drums!.voices![36];
    expect(v.tune).toBe(0);            // wrong type → default
    expect(v.level).toBe(1);           // clamped to max
    expect(v.pan).toBe(-1);            // clamped to min
    expect((v as unknown as Record<string, unknown>).junk).toBeUndefined(); // unknown key dropped
  });
});
