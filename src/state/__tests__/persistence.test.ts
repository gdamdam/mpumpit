import { describe, it, expect, beforeEach } from "vitest";
import { loadSettings, saveSettings, clearSettings, STORAGE_KEY, type PersistedSettings } from "../persistence";

const sample: PersistedSettings = {
  soundState: { bpm: 132, masterVolume: 0.5, parts: { synth: { preset: "Acid Squelch", volume: 0.6, strip: { eq: { low: 1, mid: 0, high: -2 }, hpf: { on: true, freq: 150 }, pan: 0.2, gate: { on: false, rate: "1/8", depth: 0.7, shape: "sine" } } } } as never },
  channels: { synth: 1, bass: 2, drums: 10 },
  selectedInputId: "my-controller",
};

describe("persistence", () => {
  beforeEach(() => clearSettings());

  it("round-trips settings through localStorage", () => {
    saveSettings(sample);
    const loaded = loadSettings();
    expect(loaded?.selectedInputId).toBe("my-controller");
    expect(loaded?.soundState.bpm).toBe(132);
    expect(loaded?.channels).toEqual({ synth: 1, bass: 2, drums: 10 });
  });

  it("returns null when nothing is stored", () => {
    expect(loadSettings()).toBeNull();
  });

  it("returns null on corrupt JSON", () => {
    localStorage.setItem(STORAGE_KEY, "{not json");
    expect(loadSettings()).toBeNull();
  });

  it("normalizes invalid channels to defaults", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ channels: { synth: 99, bass: "x" }, selectedInputId: 5 }));
    const loaded = loadSettings();
    expect(loaded?.channels).toEqual({ synth: 1, bass: 2, drums: 10 });
    expect(loaded?.selectedInputId).toBe("all"); // non-string falls back
  });

  it("coerces a non-object soundState to an empty object (corrupt/old payload)", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ soundState: "garbage", selectedInputId: "x" }));
    expect(loadSettings()?.soundState).toEqual({});
  });

  it("coerces an array soundState to an empty object", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ soundState: [1, 2, 3], selectedInputId: "x" }));
    expect(loadSettings()?.soundState).toEqual({});
  });

  it("normalizes malformed nested soundState without dropping valid fields", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      soundState: {
        bpm: 5000,                       // out of range → clamp
        masterVolume: 0.42,              // valid → keep
        effectOrder: { not: "an array" }, // invalid → default order
        effects: { delay: null },        // null effect → default
        userPresets: { synth: "nope" },  // non-array → []
      },
      selectedInputId: "x",
    }));
    const s = loadSettings();
    expect(s).not.toBeNull();
    expect(s!.soundState.bpm).toBe(300);            // clamped
    expect(s!.soundState.masterVolume).toBe(0.42);  // preserved
    expect(Array.isArray(s!.soundState.effectOrder)).toBe(true);
    expect(s!.soundState.effects!.delay).toMatchObject({ on: false });
    expect(s!.soundState.userPresets!.synth).toEqual([]);
  });
});
