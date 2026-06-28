import { describe, it, expect, beforeEach, vi } from "vitest";
import { SoundModule } from "../SoundModule";
import { PART_TO_AUDIO_CH } from "../../midi/types";
import { FakeAudioEngine } from "../../test/mocks";

function make(opts: { queueLimit?: number } = {}) {
  const engine = new FakeAudioEngine();
  const sm = new SoundModule({ createEngine: () => engine, queueLimit: opts.queueLimit });
  return { engine, sm };
}

describe("SoundModule — lifecycle & pre-ready queue", () => {
  it("replays only still-held notes on initialize (released notes are forgotten)", async () => {
    const { engine, sm } = make();
    expect(sm.ready).toBe(false);
    sm.noteOn("synth", 60, 100); // held
    sm.noteOn("bass", 40, 90); // held
    sm.noteOn("synth", 64, 100);
    sm.noteOff("synth", 64); // pressed then released before ready → must NOT play
    expect(engine.callsTo("liveNoteOn")).toHaveLength(0);
    await sm.initialize();
    const ons = engine.callsTo("liveNoteOn").map((c) => c.args);
    expect(ons).toEqual([[0, 60, 100], [1, 40, 90]]); // 64 forgotten, no orphan note-off
    expect(engine.callsTo("liveNoteOff")).toHaveLength(0);
  });

  it("bounds the held-note set and counts drops", async () => {
    const { engine, sm } = make({ queueLimit: 2 });
    for (let n = 1; n <= 5; n++) sm.noteOn("synth", n, 100);
    expect(sm.droppedEventCount).toBe(3);
    expect(sm.queuedEventCount).toBe(2);
    await sm.initialize();
    expect(engine.callsTo("liveNoteOn").map((c) => c.args[1])).toEqual([1, 2]);
  });

  it("plays immediately once ready", async () => {
    const { engine, sm } = make();
    await sm.initialize();
    sm.noteOn("bass", 40, 90);
    expect(engine.callsTo("liveNoteOn").at(-1)).toEqual({ method: "liveNoteOn", args: [PART_TO_AUDIO_CH.bass, 40, 90] });
  });

  it("whenReady resolves after initialize", async () => {
    const { sm } = make();
    const p = sm.whenReady();
    await sm.initialize();
    await expect(p).resolves.toBeUndefined();
  });

  it("dispose closes the engine and stops queueing", async () => {
    const { engine, sm } = make();
    await sm.initialize();
    sm.dispose();
    expect(engine.closed).toBe(true);
    expect(sm.getStatus()).toBe("disposed");
    sm.noteOn("synth", 60, 100); // no throw, not queued
    expect(sm.queuedEventCount).toBe(0);
  });
});

describe("SoundModule — presets, volumes, tempo", () => {
  let engine: FakeAudioEngine;
  let sm: SoundModule;
  beforeEach(async () => {
    ({ engine, sm } = make());
    await sm.initialize();
  });

  it("applies synth/bass presets via setSynthParams", () => {
    sm.setPreset("synth", "Acid Squelch");
    const call = engine.callsTo("setSynthParams").at(-1)!;
    expect(call.args[0]).toBe(0);
    expect(call.args[1]).toBeTypeOf("object");
  });

  it("applies a drum kit voice-by-voice", () => {
    const before = engine.callsTo("setDrumVoice").length;
    sm.setPreset("drums", "Techno");
    expect(engine.callsTo("setDrumVoice").length).toBeGreaterThan(before);
  });

  it("sets per-part and master volume", () => {
    sm.setPartVolume("drums", 0.5);
    expect(engine.callsTo("setChannelVolume").at(-1)).toEqual({ method: "setChannelVolume", args: [9, 0.5] });
    sm.setMasterVolume(0.4);
    expect(engine.callsTo("setVolume").at(-1)).toEqual({ method: "setVolume", args: [0.4] });
  });

  it("clamps volumes to 0..1", () => {
    sm.setMasterVolume(5);
    expect(engine.callsTo("setVolume").at(-1)!.args[0]).toBe(1);
  });

  it("forwards BPM for tempo-synced effects", () => {
    sm.setBpm(128);
    expect(engine.callsTo("setBpm").at(-1)).toEqual({ method: "setBpm", args: [128] });
    expect(sm.getBpm()).toBe(128);
  });
});

describe("SoundModule — panic", () => {
  it("stops synth/bass voices AND drum one-shots", async () => {
    const { engine, sm } = make();
    await sm.initialize();
    sm.panic();
    expect(engine.callsTo("allNotesOff").map((c) => c.args[0])).toEqual([0, 1]);
    expect(engine.callsTo("stopAllDrums")).toHaveLength(1); // drums aren't covered by allNotesOff
  });

  it("hard panic flushes FX tails and mutes→restores master", async () => {
    vi.useFakeTimers();
    try {
      const { engine, sm } = make();
      await sm.initialize();
      sm.setMasterVolume(0.7);
      sm.panic(true);
      expect(engine.callsTo("stopAllDrums")).toHaveLength(1);
      expect(engine.callsTo("flushFxTails")).toHaveLength(1); // discards delay/reverb so tails can't return
      expect(engine.callsTo("setVolume").at(-1)!.args[0]).toBe(0);
      vi.advanceTimersByTime(300);
      expect(engine.callsTo("setVolume").at(-1)!.args[0]).toBe(0.7);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("SoundModule — degraded engine (worklet failure)", () => {
  it("marks degraded with a warning but stays usable for drums", async () => {
    const engine = new FakeAudioEngine();
    engine.polyReady = false;
    engine.polyFailed = true;
    const sm = new SoundModule({ createEngine: () => engine });
    await sm.initialize();
    expect(sm.ready).toBe(true); // drums still work
    expect(sm.isDegraded()).toBe(true);
    expect(sm.getWarning()).toMatch(/worklet failed/i);
  });
});

describe("SoundModule — sidechain duck routing", () => {
  let engine: FakeAudioEngine;
  let sm: SoundModule;
  beforeEach(async () => { ({ engine, sm } = make()); await sm.initialize(); });

  it("enabling duck uses the real sidechain API, not setEffect", () => {
    sm.setEffectEnabled("master", "duck", true);
    expect(engine.sidechainDuck).toBe(true);
    expect(engine.callsTo("setSidechainDuck").at(-1)!.args[0]).toBe(true);
    // duck must NOT be pushed as an insert effect
    expect(engine.callsTo("setEffect").some((c) => c.args[0] === "duck")).toBe(false);
  });

  it("duck depth/release go through setDuckParams", () => {
    sm.setEffectParameter("master", "duck", "depth", 0.5);
    expect(engine.callsTo("setDuckParams").at(-1)!.args[0]).toBe(0.5);
  });
});

describe("SoundModule — FX facade", () => {
  let engine: FakeAudioEngine;
  let sm: SoundModule;
  beforeEach(async () => {
    ({ engine, sm } = make());
    await sm.initialize();
  });

  it("exposes the 11 master effects, duck pinned non-reorderable", () => {
    expect(sm.getAvailableEffects("master")).toHaveLength(11);
    const chain = sm.getEffectChain("master");
    expect(chain.reorderable).toBe(true);
    expect(chain.items).toHaveLength(11);
    const duck = chain.items.find((i) => i.id === "duck")!;
    expect(duck.reorderable).toBe(false);
  });

  it("enables/bypasses a master effect", () => {
    sm.setEffectEnabled("master", "delay", true);
    expect(engine.effects.delay.on).toBe(true);
    expect(engine.callsTo("setEffect").some((c) => c.args[0] === "delay")).toBe(true);
    expect(sm.getEffectChain("master").items.find((i) => i.id === "delay")!.enabled).toBe(true);
  });

  it("sets a master effect parameter", () => {
    sm.setEffectParameter("master", "delay", "mix", 0.5);
    expect(engine.effects.delay.mix).toBe(0.5);
  });

  it("reorders the master chain (duck excluded from order)", () => {
    const chain = sm.getEffectChain("master").items;
    const reversed = [...chain].reverse();
    sm.setMasterEffectChain(reversed);
    const order = engine.callsTo("setEffectOrder").at(-1)!.args[0] as string[];
    expect(order).not.toContain("duck");
    expect(order[0]).toBe("tremolo"); // reversed: tremolo was last reorderable
  });

  it("drums expose a full fixed channel strip (bus is real for drums)", () => {
    const chain = sm.getEffectChain("drums");
    expect(chain.reorderable).toBe(false);
    expect(chain.items.map((i) => i.id)).toEqual(["eq", "hpf", "pan", "gate"]);
  });

  it("synth/bass omit EQ & HPF — the worklet bypasses those bus nodes", () => {
    expect(sm.getEffectChain("synth").items.map((i) => i.id)).toEqual(["pan", "gate"]);
    expect(sm.getEffectChain("bass").items.map((i) => i.id)).toEqual(["pan", "gate"]);
    // and the engine gets no NEW EQ/HPF calls from synth/bass edits
    const eqBefore = engine.callsTo("setChannelEQ").length;
    const hpfBefore = engine.callsTo("setChannelHPF").length;
    sm.setEffectParameter("synth", "eq", "low", 5);
    sm.setEffectEnabled("bass", "hpf", true);
    expect(engine.callsTo("setChannelEQ").length).toBe(eqBefore);
    expect(engine.callsTo("setChannelHPF").length).toBe(hpfBefore);
  });

  it("routes drum EQ to setChannelEQ (drums route through the bus)", () => {
    sm.setEffectParameter("drums", "eq", "low", 3);
    expect(engine.callsTo("setChannelEQ").at(-1)).toEqual({ method: "setChannelEQ", args: [9, 3, 0, 0] });
  });

  it("toggles a part gate via setChannelGate", () => {
    sm.setEffectEnabled("bass", "gate", true);
    const call = engine.callsTo("setChannelGate").at(-1)!;
    expect(call.args[0]).toBe(1);
    expect(call.args[1]).toBe(true);
  });

  it("bypassed drum HPF sends an allpass (freq 20)", () => {
    sm.setEffectParameter("drums", "hpf", "freq", 200);
    sm.setEffectEnabled("drums", "hpf", true);
    expect(engine.callsTo("setChannelHPF").at(-1)).toEqual({ method: "setChannelHPF", args: [9, 200] });
    sm.setEffectEnabled("drums", "hpf", false);
    expect(engine.callsTo("setChannelHPF").at(-1)).toEqual({ method: "setChannelHPF", args: [9, 20] });
  });

  it("resets one master effect and all effects to defaults", () => {
    sm.setEffectParameter("master", "reverb", "mix", 0.9);
    sm.resetEffect("master", "reverb");
    expect(sm.getEffectChain("master").items.find((i) => i.id === "reverb")!.params.mix).toBe(0.45);
    sm.setEffectEnabled("master", "delay", true);
    sm.resetAllEffects();
    expect(sm.getEffectChain("master").items.find((i) => i.id === "delay")!.enabled).toBe(false);
  });
});

describe("SoundModule — persistence round-trip", () => {
  it("getState reflects mutations and re-seeds a new module", async () => {
    const { sm } = make();
    sm.setBpm(140);
    sm.setPartVolume("synth", 0.33);
    sm.setEffectEnabled("master", "reverb", true);
    const state = sm.getState();
    expect(state.bpm).toBe(140);

    const engine2 = new FakeAudioEngine();
    const sm2 = new SoundModule({ createEngine: () => engine2, initialState: state });
    await sm2.initialize();
    expect(engine2.callsTo("setBpm").some((c) => c.args[0] === 140)).toBe(true);
    expect(engine2.effects.reverb.on).toBe(true);
  });
});
