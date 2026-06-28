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
});
