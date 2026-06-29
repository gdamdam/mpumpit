import { describe, it, expect, beforeEach, vi } from "vitest";
import { SoundModule } from "../SoundModule";
import { PART_TO_AUDIO_CH } from "../../midi/types";
import { DEFAULT_EFFECT_ORDER } from "../types";
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

  it("re-applies synth/bass worklet settings AFTER the worklet loads (P2)", async () => {
    // Pan/gate for synth/bass are sent to the poly-synth worklet, which doesn't
    // exist during applyAll(); they must be re-sent once it's ready.
    const { engine, sm } = make();
    await sm.initialize();
    const calls = engine.calls;
    const resumeIdx = calls.findIndex((c) => c.method === "resume");
    expect(resumeIdx).toBeGreaterThanOrEqual(0);
    const panAfter = calls.some((c, i) => i > resumeIdx && c.method === "setChannelPan" && c.args[0] === 0);
    const gateAfter = calls.some((c, i) => i > resumeIdx && c.method === "setChannelGate" && c.args[0] === 0);
    expect(panAfter).toBe(true);
    expect(gateAfter).toBe(true);
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

  it("includes all 8 classic-machine drum kits (imported from mpump)", () => {
    const names = sm.getPresetNames("drums");
    for (const m of ["CR-78", "DMX", "Drumulator", "LinnDrum", "TR-606", "TR-707", "TR-808", "TR-909"]) {
      expect(names).toContain(m);
    }
  });

  it("loads an imported machine kit by name", () => {
    const before = engine.callsTo("setDrumVoice").length;
    sm.setPreset("drums", "TR-808");
    expect(engine.callsTo("setDrumVoice").length).toBeGreaterThan(before);
    expect(sm.getState().parts.drums.preset).toBe("TR-808");
  });

  it("lists presets alphabetically with Default pinned first", () => {
    for (const part of ["synth", "bass", "drums"] as const) {
      const names = sm.getPresetNames(part);
      expect(names[0]).toBe("Default");
      const rest = names.slice(1);
      expect(rest).toEqual([...rest].sort((a, b) => a.localeCompare(b)));
    }
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

describe("SoundModule — sound editing & user presets", () => {
  let engine: FakeAudioEngine;
  let sm: SoundModule;
  beforeEach(async () => { ({ engine, sm } = make()); await sm.initialize(); });

  it("edits synth params and routes them to the engine", () => {
    sm.setSynthParam("synth", { cutoff: 1234 });
    expect(sm.getSynthParams("synth").cutoff).toBe(1234);
    const call = engine.callsTo("setSynthParams").at(-1)!;
    expect(call.args[0]).toBe(0);
    expect((call.args[1] as { cutoff: number }).cutoff).toBe(1234);
  });

  it("marks the part modified, and clears on preset reload", () => {
    expect(sm.isPartModified("synth")).toBe(false);
    sm.setSynthParam("synth", { cutoff: 1234 });
    expect(sm.isPartModified("synth")).toBe(true);
    sm.setPreset("synth", "Default");
    expect(sm.isPartModified("synth")).toBe(false);
  });

  it("selecting a preset replaces the live params", () => {
    sm.setPreset("synth", "Acid Squelch");
    const acid = sm.getSynthParams("synth");
    sm.setPreset("synth", "Default");
    expect(sm.getSynthParams("synth")).not.toEqual(acid);
  });

  it("edits a drum voice and routes it to the engine", () => {
    sm.setDrumVoiceParam(36, { tune: 5 });
    expect(sm.getDrumVoice(36).tune).toBe(5);
    expect(engine.callsTo("setDrumVoice").at(-1)!.args[0]).toBe(36);
  });

  it("saves, recalls and deletes user presets", () => {
    sm.setSynthParam("synth", { cutoff: 999 });
    sm.saveUserPreset("synth", "My Lead");
    expect(sm.getPresetNames("synth")).toContain("My Lead");
    expect(sm.getUserPresetNames("synth")).toEqual(["My Lead"]);
    sm.setPreset("synth", "Default");
    sm.setPreset("synth", "My Lead");
    expect(sm.getSynthParams("synth").cutoff).toBe(999); // recalled
    sm.deleteUserPreset("synth", "My Lead");
    expect(sm.getPresetNames("synth")).not.toContain("My Lead");
  });

  it("deleting the active user preset falls back to Default", () => {
    sm.saveUserPreset("synth", "Temp");
    sm.deleteUserPreset("synth", "Temp");
    expect(sm.getState().parts.synth.preset).toBe("Default");
  });

  it("switching kits fully resets every voice (incl optional params and CB2)", () => {
    sm.setDrumVoiceParam(56, { tune: 12 });
    sm.setDrumVoiceParam(36, { filterCutoff: 0.3 }); // optional param a kit may omit
    const before = engine.callsTo("setDrumVoice").length;
    sm.setPreset("drums", "Techno");
    expect(sm.getDrumVoice(56).tune).toBe(0); // CB2 reset
    expect(sm.getDrumVoice(36).filterCutoff).toBe(1); // stale optional cleared, not retained
    // the engine received a COMPLETE voice for 36 (filterCutoff explicitly reset)
    const kick = engine.callsTo("setDrumVoice").slice(before).find((c) => c.args[0] === 36)!;
    expect((kick.args[1] as { filterCutoff: number }).filterCutoff).toBe(1);
    expect(engine.callsTo("setDrumVoice").slice(before).some((c) => c.args[0] === 56)).toBe(true);
  });

  it("exposes per-note pan defaults, not a global 0", () => {
    expect(sm.getDrumVoice(37).pan).toBe(0.2); // RS
    expect(sm.getDrumVoice(56).pan).toBe(-0.25); // CB2
    expect(sm.getDrumVoice(36).pan).toBe(0); // BD
  });

  it("user presets never collide with a built-in name (stay recallable)", () => {
    sm.setSynthParam("synth", { cutoff: 321 });
    sm.saveUserPreset("synth", "Default"); // collides with the built-in
    expect(sm.getUserPresetNames("synth")).toContain("Default (user)");
    expect(sm.getUserPresetNames("synth")).not.toContain("Default");
    sm.setPreset("synth", "Acid Squelch");
    sm.setPreset("synth", "Default (user)");
    expect(sm.getSynthParams("synth").cutoff).toBe(321); // recalled, not the built-in
  });
});

describe("SoundModule — editing persistence & back-compat", () => {
  it("round-trips edited params, voices and user presets", async () => {
    const { sm } = make();
    sm.setSynthParam("bass", { cutoff: 777 });
    sm.setDrumVoiceParam(38, { decay: 2 });
    sm.saveUserPreset("synth", "Saved");
    const state = sm.getState();
    expect(state.parts.bass.params!.cutoff).toBe(777);

    const engine2 = new FakeAudioEngine();
    const sm2 = new SoundModule({ createEngine: () => engine2, initialState: state });
    await sm2.initialize();
    expect(sm2.getSynthParams("bass").cutoff).toBe(777);
    expect(sm2.getDrumVoice(38).decay).toBe(2);
    expect(sm2.getUserPresetNames("synth")).toContain("Saved");
    expect(engine2.callsTo("setSynthParams").some((c) => (c.args[1] as { cutoff: number }).cutoff === 777)).toBe(true);
  });

  it("hydrates params from the named preset for pre-editor saved state", () => {
    const engine = new FakeAudioEngine();
    const sm = new SoundModule({
      createEngine: () => engine,
      initialState: { parts: { synth: { preset: "Acid Squelch", volume: 0.8 } } } as never,
    });
    expect(sm.isPartModified("synth")).toBe(false); // hydrated to equal the named preset
    expect(sm.getSynthParams("synth")).not.toEqual(sm.getSynthParams("bass")); // got Acid Squelch, not Default
  });
});

describe("SoundModule — initialization retry (issue 1)", () => {
  it("recovers when the first initialization fails and the second succeeds", async () => {
    const created: FakeAudioEngine[] = [];
    const sm = new SoundModule({
      createEngine: () => {
        const e = new FakeAudioEngine();
        if (created.length === 0) e.failResume = true; // first attempt rejects in resume()
        created.push(e);
        return e;
      },
    });
    await expect(sm.initialize()).rejects.toThrow(/resume failed/);
    expect(sm.getStatus()).toBe("idle"); // reset so a retry is possible
    expect(created[0].closed).toBe(true); // partial engine torn down

    await sm.initialize(); // genuine retry
    expect(sm.ready).toBe(true);
    expect(created).toHaveLength(2); // a FRESH engine was created
  });

  it("resets and retries when the engine factory itself throws", async () => {
    let attempt = 0;
    const sm = new SoundModule({
      createEngine: () => {
        if (attempt++ === 0) throw new Error("ctx blocked");
        return new FakeAudioEngine();
      },
    });
    await expect(sm.initialize()).rejects.toThrow(/ctx blocked/);
    expect(sm.getStatus()).toBe("idle");
    await sm.initialize();
    expect(sm.ready).toBe(true);
  });

  it("shares one initialization across concurrent successful calls (idempotent)", async () => {
    const created: FakeAudioEngine[] = [];
    const sm = new SoundModule({ createEngine: () => { const e = new FakeAudioEngine(); created.push(e); return e; } });
    await Promise.all([sm.initialize(), sm.initialize(), sm.initialize()]);
    expect(sm.ready).toBe(true);
    expect(created).toHaveLength(1); // only one engine for concurrent calls
  });
});

describe("SoundModule — dispose during async init (lifecycle)", () => {
  it("dispose() mid-initialization never flips back to ready", async () => {
    const engine = new FakeAudioEngine();
    engine.polyReady = false; // force the worklet wait so dispose lands mid-init
    const sm = new SoundModule({ createEngine: () => engine, polySynthTimeoutMs: 30 });
    const p = sm.initialize();
    sm.dispose(); // tear down while doInitialize is awaiting
    await p;
    expect(sm.getStatus()).toBe("disposed");
    expect(sm.ready).toBe(false);
    expect(engine.closed).toBe(true);

    // A late worklet settle after disposal must be ignored (no revival/emit).
    engine.polyReady = true;
    engine.settlePolySynth();
    expect(sm.getStatus()).toBe("disposed");
  });
});

describe("SoundModule — late worklet readiness past the timeout (issue 2)", () => {
  it("clears degraded and re-applies synth/bass settings on a late load", async () => {
    const engine = new FakeAudioEngine();
    engine.polyReady = false;
    engine.polyFailed = false;
    const sm = new SoundModule({ createEngine: () => engine, polySynthTimeoutMs: 10 });
    await sm.initialize();
    expect(sm.ready).toBe(true); // drums usable immediately
    expect(sm.isDegraded()).toBe(true);
    expect(sm.getWarning()).toMatch(/still initializing/i);

    const before = engine.callsTo("setSynthParams").length;
    engine.polyReady = true;
    engine.settlePolySynth(); // worklet finishes AFTER the timeout

    expect(sm.isDegraded()).toBe(false);
    expect(sm.getWarning()).toBeNull();
    // worklet-owned settings re-applied (synth + bass params re-sent)
    expect(engine.callsTo("setSynthParams").length).toBeGreaterThan(before);
  });

  it("reports definitive failure when the worklet fails after the timeout", async () => {
    const engine = new FakeAudioEngine();
    engine.polyReady = false;
    const sm = new SoundModule({ createEngine: () => engine, polySynthTimeoutMs: 10 });
    await sm.initialize();
    expect(sm.getWarning()).toMatch(/still initializing/i);

    engine.polyFailed = true;
    engine.settlePolySynth();
    expect(sm.isDegraded()).toBe(true);
    expect(sm.getWarning()).toMatch(/failed/i);
  });
});

describe("SoundModule — malformed persisted state (issue 3)", () => {
  const build = (initialState: unknown) =>
    new SoundModule({ createEngine: () => new FakeAudioEngine(), initialState: initialState as never });

  it("does not throw on a non-array effectOrder and restores the default order", () => {
    const sm = build({ effectOrder: { junk: true } });
    expect(() => sm.getEffectChain("master")).not.toThrow();
    const ids = sm.getEffectChain("master").items.map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining([...DEFAULT_EFFECT_ORDER, "duck"]));
  });

  it("drops unknown/duplicate effects and restores each missing one exactly once", () => {
    const order = build({ effectOrder: ["reverb", "reverb", "bogus", "delay"] }).getState().effectOrder;
    expect(new Set(order).size).toBe(order.length); // no duplicates
    expect(order).not.toContain("bogus"); // unknown dropped
    expect(order.filter((e) => e === "reverb")).toHaveLength(1);
    expect(order).toEqual(expect.arrayContaining(DEFAULT_EFFECT_ORDER)); // all defaults present
  });

  it("replaces a null / non-object effect with its default but keeps valid fields", () => {
    const sm = build({ effects: { delay: null, reverb: 5, compressor: { on: "yes", threshold: -10 } } });
    expect(() => sm.getEffectChain("master")).not.toThrow();
    const eff = sm.getState().effects;
    expect(typeof eff.delay).toBe("object");
    expect(eff.delay.on).toBe(false); // defaulted
    expect(eff.compressor.on).toBe(true); // truthy coerced to boolean
    expect(eff.compressor.threshold).toBe(-10); // valid value preserved
  });

  it("defaults non-array user-preset collections but keeps valid ones", () => {
    const sm = build({ userPresets: { synth: "nope", bass: 5, drums: [{ name: "Kit", voices: {} }] } });
    expect(sm.getUserPresetNames("synth")).toEqual([]);
    expect(sm.getUserPresetNames("drums")).toContain("Kit");
  });

  it("clamps out-of-range numerics (bpm/volume) to valid bounds", () => {
    const st = build({ bpm: 5000, masterVolume: 9 }).getState();
    expect(st.bpm).toBe(300);
    expect(st.masterVolume).toBe(1);
  });

  it("tolerates invalid parts/strip/voices/drumMap shapes without throwing", () => {
    const sm = build({
      parts: { synth: "x", drums: { volume: "loud", strip: 5, voices: [1, 2, 3] } },
      drumMap: [1, 2, 3],
    });
    expect(() => sm.getState()).not.toThrow();
    expect(() => sm.getEffectChain("synth")).not.toThrow();
    expect(sm.getDrumMap()).toEqual({}); // array drumMap → empty
  });

  it("never throws on a wholly garbage payload", () => {
    expect(() =>
      build({ masterVolume: "x", bpm: {}, effects: 7, effectOrder: 9, parts: 3, userPresets: 1, drumMap: "z" }).getState(),
    ).not.toThrow();
  });
});

describe("SoundModule — master output stage", () => {
  const lastArgs = (engine: FakeAudioEngine, method: string) => engine.callsTo(method).at(-1)?.args;

  it("pushes the full master stage to the engine on initialize (drums routed through FX by default)", async () => {
    const { engine, sm } = make();
    await sm.initialize();
    expect(lastArgs(engine, "setMasterEq")).toEqual([2, -2, 1]);
    expect(lastArgs(engine, "setLowCut")).toEqual([0]);
    expect(lastArgs(engine, "setMultibandEnabled")).toEqual([false]);
    expect(lastArgs(engine, "setMultibandAmount")).toEqual([0.25]);
    expect(lastArgs(engine, "setAntiClipMode")).toEqual(["limiter"]);
    expect(lastArgs(engine, "setDrive")).toEqual([1]);
    expect(lastArgs(engine, "setMasterBoost")).toEqual([2]);
    expect(lastArgs(engine, "setWidth")).toEqual([0.5]);
    // drumsThroughFx true ⇒ NOT MB-excluded ⇒ drums run through the FX chain.
    expect(lastArgs(engine, "setMbExclude")).toEqual(["drums", false]);
  });

  it("granular setters update state and push only the affected engine node", async () => {
    const { engine, sm } = make();
    await sm.initialize();
    sm.setMasterEq(3, -1, 4);
    sm.setMasterDrive(-2);
    sm.setLimiterMode("hybrid");
    sm.setMultibandEnabled(true);
    expect(sm.getMaster().eq).toEqual({ low: 3, mid: -1, high: 4 });
    expect(sm.getMaster().drive).toBe(-2);
    expect(sm.getMaster().limiterMode).toBe("hybrid");
    expect(lastArgs(engine, "setMasterEq")).toEqual([3, -1, 4]);
    expect(lastArgs(engine, "setDrive")).toEqual([-2]);
    expect(lastArgs(engine, "setAntiClipMode")).toEqual(["hybrid"]);
  });

  it("clamps out-of-range values into engine bounds", () => {
    const { sm } = make();
    sm.setMasterEq(99, -99, 0);
    sm.setMasterDrive(100);
    sm.setMasterBoost(0);
    expect(sm.getMaster().eq).toEqual({ low: 12, mid: -12, high: 0 });
    expect(sm.getMaster().drive).toBe(12);
    expect(sm.getMaster().boost).toBe(0.5);
  });

  it("Drums → FX toggle maps to the inverse MB-exclude flag", async () => {
    const { engine, sm } = make();
    await sm.initialize();
    sm.setDrumsThroughFx(false);
    expect(sm.getMaster().drumsThroughFx).toBe(false);
    expect(lastArgs(engine, "setMbExclude")).toEqual(["drums", true]);
  });

  it("resetMaster restores defaults and re-applies them to the engine", async () => {
    const { engine, sm } = make();
    await sm.initialize();
    sm.setMasterDrive(-5);
    sm.setMultibandEnabled(true);
    sm.resetMaster();
    expect(sm.getMaster().drive).toBe(1);
    expect(sm.getMaster().multibandOn).toBe(false);
    expect(lastArgs(engine, "setDrive")).toEqual([1]);
    expect(lastArgs(engine, "setMultibandEnabled")).toEqual([false]);
  });

  it("normalizes a malformed persisted master to defaults without throwing", () => {
    const sm = new SoundModule({
      createEngine: () => new FakeAudioEngine(),
      initialState: { master: { eq: 5, lowCut: "x", multibandOn: 1, limiterMode: "boom", drive: NaN, boost: 99 } } as never,
    });
    const m = sm.getMaster();
    expect(m.eq).toEqual({ low: 2, mid: -2, high: 1 }); // bad eq → defaults
    expect(m.limiterMode).toBe("limiter"); // unknown enum → default
    expect(m.drive).toBe(1); // NaN → default
    expect(m.boost).toBe(3); // 99 clamped to max
  });

  it("round-trips master settings through getState into a fresh module", async () => {
    const { sm } = make();
    sm.setMasterEq(5, 5, 5);
    sm.setMultibandAmount(0.8);
    sm.setDrumsThroughFx(false);
    const state = sm.getState();
    expect(state.master.eq).toEqual({ low: 5, mid: 5, high: 5 });

    const engine2 = new FakeAudioEngine();
    const sm2 = new SoundModule({ createEngine: () => engine2, initialState: state });
    await sm2.initialize();
    expect(sm2.getMaster().eq).toEqual({ low: 5, mid: 5, high: 5 });
    expect(sm2.getMaster().multibandAmount).toBe(0.8);
    expect(engine2.callsTo("setMbExclude").at(-1)?.args).toEqual(["drums", true]);
  });
});
