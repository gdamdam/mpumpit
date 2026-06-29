// SoundModule — async-lifecycle facade over mpump's AudioPort. Original work,
// AGPL-3.0-only (it drives mpump's AGPL engine, so the whole is AGPL).
//
// Responsibilities:
//  - explicit lifecycle: initialize() / ready / resume() / dispose()
//  - note routing to fixed engine channels (synth=0, bass=1, drums=9)
//  - a BOUNDED queue so MIDI received before the engine is ready is replayed
//    rather than silently dropped
//  - presets, per-part + master volume, global BPM (for tempo-synced FX)
//  - panic (all-notes-off) with an optional hard master-mute to cut FX tails
//  - an honest FX facade: a reorderable MASTER effect chain (mpump's real
//    model) plus a fixed per-part channel strip (EQ / HPF / pan / gate)

import type { EffectName, EffectParams, SynthParams, DrumVoiceParams } from "../engine/types";
import { DEFAULT_EFFECTS } from "../engine/types";
import { SYNTH_PRESETS, BASS_PRESETS, DRUM_KIT_PRESETS } from "../engine/soundPresets";
import { AudioPort } from "../engine/AudioPort";
import { PART_TO_AUDIO_CH, type Part } from "../midi/types";
import {
  MASTER_EFFECTS, DEFAULT_EFFECT_ORDER, DEFAULT_CHANNEL_STRIP,
  type FxTarget, type FxChain, type FxChainItem, type SoundState, type PartState, type ChannelStrip,
} from "./types";

/** The subset of AudioPort the facade needs. Lets tests inject a fake engine. */
export interface AudioEngine {
  liveNoteOn(ch: number, note: number, vel: number): void;
  liveNoteOff(ch: number, note: number): void;
  allNotesOff(ch: number): void;
  setSynthParams(ch: number, params: SynthParams): void;
  setDrumVoice(note: number, params: Partial<DrumVoiceParams>): void;
  setEffect(name: EffectName, params: Record<string, unknown>): void;
  getEffects(): EffectParams;
  setEffectOrder(order: EffectName[]): void;
  getEffectOrder(): EffectName[];
  setSidechainDuck(on: boolean): void;
  setDuckParams(depth: number, release: number, excludeBass?: boolean, excludeSynth?: boolean): void;
  setBpm(bpm: number): void;
  setChannelVolume(ch: number, v: number): void;
  setChannelEQ(ch: number, low: number, mid: number, high: number): void;
  setChannelHPF(ch: number, freq: number): void;
  setChannelPan(ch: number, pan: number): void;
  setChannelGate(ch: number, on: boolean, rate: string, depth: number, shape: string): void;
  setVolume(v: number): void;
  stopAllDrums(): void;
  flushFxTails(): void;
  isPolySynthReady(): boolean;
  didPolySynthFail(): boolean;
  getContextState(): string;
  resume(): Promise<void>;
  close(): void;
}

export type EngineFactory = () => AudioEngine;

export type SoundStatus = "idle" | "initializing" | "ready" | "disposed";

export interface SoundModuleOptions {
  initialState?: Partial<SoundState>;
  /** Engine factory; defaults to a real AudioPort. Override in tests. */
  createEngine?: EngineFactory;
  /** Max note events buffered before the engine is ready (default 64). */
  queueLimit?: number;
}

interface HeldNote {
  part: Part;
  note: number;
  velocity: number;
}

const HARD_SILENCE_MS = 150;

function defaultPartState(preset: string): PartState {
  return { preset, volume: 0.8, strip: structuredCloneStrip(DEFAULT_CHANNEL_STRIP) };
}

function structuredCloneStrip(s: ChannelStrip): ChannelStrip {
  return { eq: { ...s.eq }, hpf: { ...s.hpf }, pan: s.pan, gate: { ...s.gate } };
}

export function defaultSoundState(): SoundState {
  return {
    masterVolume: 0.85,
    bpm: 120,
    effects: structuredClone(DEFAULT_EFFECTS),
    effectOrder: [...DEFAULT_EFFECT_ORDER],
    drumMap: {},
    parts: {
      synth: defaultPartState("Default"),
      bass: defaultPartState("Default"),
      drums: defaultPartState("Default"),
    },
  };
}

export class SoundModule {
  private engine: AudioEngine | null = null;
  private readonly createEngine: EngineFactory;
  private readonly queueLimit: number;
  private state: SoundState;

  private status: SoundStatus = "idle";
  private initPromise: Promise<void> | null = null;
  private readyResolvers: Array<() => void> = [];

  // Notes physically held when MIDI arrives before the engine is ready. Keyed
  // by part:note, so a release simply forgets the note — no orphan Note Offs or
  // ghost Note Ons can survive to playback. Only still-held notes replay on
  // start. Bounded by queueLimit.
  private pendingHeld = new Map<string, HeldNote>();
  private droppedEvents = 0;
  private degraded = false;
  private warning: string | null = null;
  private hardSilenceTimer: ReturnType<typeof setTimeout> | null = null;

  private listeners = new Set<() => void>();

  constructor(opts: SoundModuleOptions = {}) {
    this.createEngine = opts.createEngine ?? (() => defaultAudioPortEngine());
    this.queueLimit = opts.queueLimit ?? 64;
    this.state = opts.initialState
      ? mergeState(defaultSoundState(), opts.initialState)
      : defaultSoundState();
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  get ready(): boolean {
    return this.status === "ready";
  }

  getStatus(): SoundStatus {
    return this.status;
  }

  /** Resolves once the engine is ready (or immediately if already ready). */
  whenReady(): Promise<void> {
    if (this.status === "ready") return Promise.resolve();
    return new Promise((resolve) => this.readyResolvers.push(resolve));
  }

  /**
   * Construct the engine (must be called from a user gesture — it creates an
   * AudioContext), apply current state, resume, and flush any queued notes.
   * Idempotent: concurrent/repeat calls share one initialization.
   */
  async initialize(): Promise<void> {
    if (this.status === "ready") return;
    if (this.initPromise) return this.initPromise;
    this.status = "initializing";
    this.initPromise = this.doInitialize();
    return this.initPromise;
  }

  private async doInitialize(): Promise<void> {
    const engine = this.createEngine();
    this.engine = engine;
    this.applyAll();
    await engine.resume();
    // Wait for the poly-synth worklet specifically (the only synth/bass voice).
    // Holding here keeps the pre-ready queue alive so live notes are not dropped
    // while it loads; we resolve as soon as it is ready, fails, or times out.
    await this.waitForPolySynth(8000);
    if (engine.didPolySynthFail()) {
      this.degraded = true;
      this.warning = "Synth & bass are unavailable — their audio worklet failed to load. Drums still work.";
    } else if (!engine.isPolySynthReady()) {
      this.degraded = true;
      this.warning = "Synth & bass are still initializing — notes may be silent until the worklet finishes loading.";
    }
    // Synth/bass pan, gate, preset and volume are routed to the poly-synth
    // worklet, but applyAll() ran before it existed (it loads async), so those
    // messages were dropped. Re-send them now the worklet is here, or the saved
    // values show in the UI but stay inaudible after a reload.
    if (engine.isPolySynthReady()) this.applyAfterWorklet();
    this.status = "ready";
    this.flushPending();
    this.readyResolvers.forEach((r) => r());
    this.readyResolvers = [];
    this.emit();
  }

  private waitForPolySynth(timeoutMs: number): Promise<void> {
    const engine = this.engine;
    if (!engine) return Promise.resolve();
    return new Promise((resolve) => {
      const start = performance.now();
      const tick = () => {
        if (!this.engine) return resolve();
        if (engine.isPolySynthReady() || engine.didPolySynthFail() || performance.now() - start >= timeoutMs) {
          return resolve();
        }
        setTimeout(tick, 50);
      };
      tick();
    });
  }

  /** True when the engine started but the synth/bass worklet is unavailable. */
  isDegraded(): boolean {
    return this.degraded;
  }

  /** A human-readable warning when something is degraded, else null. */
  getWarning(): string | null {
    return this.warning;
  }

  /** AudioContext state for diagnostics ("running"/"suspended"/null). */
  getContextState(): string | null {
    return this.engine?.getContextState() ?? null;
  }

  async resume(): Promise<void> {
    if (this.engine) await this.engine.resume();
  }

  dispose(): void {
    if (this.hardSilenceTimer) {
      clearTimeout(this.hardSilenceTimer);
      this.hardSilenceTimer = null;
    }
    if (this.engine) {
      try { this.engine.allNotesOff(PART_TO_AUDIO_CH.synth); } catch { /* ignore */ }
      try { this.engine.allNotesOff(PART_TO_AUDIO_CH.bass); } catch { /* ignore */ }
      try { this.engine.allNotesOff(PART_TO_AUDIO_CH.drums); } catch { /* ignore */ }
      try { this.engine.close(); } catch { /* ignore */ }
    }
    this.engine = null;
    this.pendingHeld.clear();
    this.initPromise = null;
    this.status = "disposed";
    this.emit();
  }

  // ── Notes ────────────────────────────────────────────────────────────────

  noteOn(part: Part, note: number, velocity: number): void {
    if (this.status === "ready" && this.engine) {
      this.unmuteIfSilenced();
      this.engine.liveNoteOn(PART_TO_AUDIO_CH[part], note, velocity);
      return;
    }
    if (this.status === "disposed") return;
    const key = `${part}:${note}`;
    // Bound the set of held notes; ignore (and count) new keys past the limit,
    // but always allow re-pressing a key already held (no growth).
    if (!this.pendingHeld.has(key) && this.pendingHeld.size >= this.queueLimit) {
      this.droppedEvents++;
      return;
    }
    this.pendingHeld.set(key, { part, note, velocity });
  }

  noteOff(part: Part, note: number): void {
    if (this.status === "ready" && this.engine) {
      this.engine.liveNoteOff(PART_TO_AUDIO_CH[part], note);
      return;
    }
    if (this.status === "disposed") return;
    // Released before the engine was ready → simply forget it; it never plays.
    this.pendingHeld.delete(`${part}:${note}`);
  }

  private flushPending(): void {
    if (!this.engine) return;
    const held = [...this.pendingHeld.values()];
    this.pendingHeld.clear();
    for (const h of held) this.engine.liveNoteOn(PART_TO_AUDIO_CH[h.part], h.note, h.velocity);
  }

  /** Count of note presses dropped because the pre-ready queue was full. */
  get droppedEventCount(): number {
    return this.droppedEvents;
  }

  /** Number of notes still held, waiting for the engine to become ready. */
  get queuedEventCount(): number {
    return this.pendingHeld.size;
  }

  // A hard panic mutes the master; restore it on the next note so a held FX
  // tail (already flushed) never re-emerges and the player isn't left silent.
  private unmuteIfSilenced(): void {
    if (this.hardSilenceTimer) {
      clearTimeout(this.hardSilenceTimer);
      this.hardSilenceTimer = null;
      this.engine?.setVolume(this.state.masterVolume);
    }
  }

  // ── Panic ────────────────────────────────────────────────────────────────

  /**
   * Silence the whole engine: stop synth/bass voices AND active drum one-shots
   * (drums are buffers that `allNotesOff` cannot stop). FX tails decay safely.
   * `hard` also flushes the FX chain (discarding delay/reverb buffers so tails
   * cannot return) under a brief master mute, then restores the master volume.
   */
  panic(hard = false): void {
    this.pendingHeld.clear();
    if (!this.engine) return;
    this.engine.allNotesOff(PART_TO_AUDIO_CH.synth);
    this.engine.allNotesOff(PART_TO_AUDIO_CH.bass);
    this.engine.stopAllDrums();
    if (hard) {
      this.engine.setVolume(0);
      this.engine.flushFxTails(); // rebuild delay/reverb nodes → tails gone
      if (this.hardSilenceTimer) clearTimeout(this.hardSilenceTimer);
      this.hardSilenceTimer = setTimeout(() => {
        this.hardSilenceTimer = null;
        if (this.engine) this.engine.setVolume(this.state.masterVolume);
      }, HARD_SILENCE_MS);
    }
  }

  // ── Presets / volumes / tempo ──────────────────────────────────────────────

  setPreset(part: Part, presetName: string): void {
    this.state.parts[part].preset = presetName;
    this.applyPreset(part);
    this.emit();
  }

  getPresetNames(part: Part): string[] {
    if (part === "drums") return DRUM_KIT_PRESETS.map((p) => p.name);
    return (part === "bass" ? BASS_PRESETS : SYNTH_PRESETS).map((p) => p.name);
  }

  private applyPreset(part: Part): void {
    if (!this.engine) return;
    const name = this.state.parts[part].preset;
    if (part === "drums") {
      const kit = DRUM_KIT_PRESETS.find((k) => k.name === name) ?? DRUM_KIT_PRESETS[0];
      for (const [note, vp] of Object.entries(kit.voices)) {
        this.engine.setDrumVoice(Number(note), vp);
      }
    } else {
      const list = part === "bass" ? BASS_PRESETS : SYNTH_PRESETS;
      const preset = list.find((p) => p.name === name) ?? list[0];
      this.engine.setSynthParams(PART_TO_AUDIO_CH[part], preset.params);
    }
  }

  setPartVolume(part: Part, volume: number): void {
    const v = clamp01(volume);
    this.state.parts[part].volume = v;
    this.engine?.setChannelVolume(PART_TO_AUDIO_CH[part], v);
    this.emit();
  }

  setMasterVolume(volume: number): void {
    const v = clamp01(volume);
    this.state.masterVolume = v;
    // If a hard-silence is active, don't fight it; it restores to this value.
    if (!this.hardSilenceTimer) this.engine?.setVolume(v);
    this.emit();
  }

  setBpm(bpm: number): void {
    const b = Math.max(20, Math.min(300, bpm));
    this.state.bpm = b;
    this.engine?.setBpm(b);
    this.emit();
  }

  getBpm(): number {
    return this.state.bpm;
  }

  // ── Drum compatibility map ─────────────────────────────────────────────────

  getDrumMap(): Record<number, number> {
    return { ...this.state.drumMap };
  }

  setDrumMap(overrides: Record<number, number>): void {
    this.state.drumMap = { ...overrides };
    this.emit();
  }

  // ── FX facade ──────────────────────────────────────────────────────────────

  getAvailableEffects(target: FxTarget): string[] {
    if (target === "master") return [...MASTER_EFFECTS];
    return this.stripEffectsFor(target);
  }

  /**
   * Which channel-strip sections actually affect a part's sound. Synth & bass
   * are produced by the poly-synth worklet, which honors pan & gate (sent as
   * worklet messages) but has no per-channel EQ/HPF — those Web Audio bus nodes
   * are bypassed for the worklet, so we don't expose dead controls. Drums route
   * through the real channel bus, so all four apply. Synth/bass tone shaping
   * uses the preset filter and the Master high-pass (with per-part Applies-to).
   */
  private stripEffectsFor(part: Part): string[] {
    return part === "drums" ? ["eq", "hpf", "pan", "gate"] : ["pan", "gate"];
  }

  getEffectChain(target: FxTarget): FxChain {
    if (target === "master") return this.getMasterChain();
    return this.getPartChain(target);
  }

  private getMasterChain(): FxChain {
    const fx = this.state.effects;
    const items: FxChainItem[] = this.state.effectOrder.map((id) => ({
      id,
      enabled: !!fx[id].on,
      reorderable: true,
      params: { ...fx[id] },
    }));
    // `duck` is a kick-triggered sidechain mpump keeps out of the reorderable
    // order — represent it honestly as a pinned, non-reorderable item.
    items.push({ id: "duck", enabled: !!fx.duck.on, reorderable: false, params: { ...fx.duck } });
    return { target: "master", reorderable: true, items };
  }

  private getPartChain(part: Part): FxChain {
    const s = this.state.parts[part].strip;
    const all: Record<string, FxChainItem> = {
      eq: { id: "eq", enabled: true, reorderable: false, params: { ...s.eq } },
      hpf: { id: "hpf", enabled: s.hpf.on, reorderable: false, params: { freq: s.hpf.freq } },
      pan: { id: "pan", enabled: true, reorderable: false, params: { pan: s.pan } },
      gate: { id: "gate", enabled: s.gate.on, reorderable: false, params: { ...s.gate } },
    };
    const items = this.stripEffectsFor(part).map((id) => all[id]);
    return { target: part, reorderable: false, items };
  }

  setMasterEffectChain(chain: FxChainItem[]): void {
    this.setEffectChain("master", chain);
  }

  setEffectChain(target: FxTarget, chain: FxChainItem[]): void {
    if (target === "master") {
      const order = chain.map((i) => i.id).filter((id) => id !== "duck") as EffectName[];
      if (order.length) {
        this.state.effectOrder = order;
        this.engine?.setEffectOrder(order);
      }
      for (const item of chain) {
        const id = item.id as EffectName;
        if (!(id in this.state.effects)) continue;
        Object.assign(this.state.effects[id], item.params, { on: item.enabled });
        this.applyMasterEffect(id);
      }
    } else {
      for (const item of chain) this.applyPartItem(target, item.id, item.enabled, item.params);
    }
    this.emit();
  }

  setEffectEnabled(target: FxTarget, effectId: string, enabled: boolean): void {
    if (target === "master") {
      const id = effectId as EffectName;
      if (!(id in this.state.effects)) return;
      this.state.effects[id].on = enabled;
      this.applyMasterEffect(id);
    } else {
      if (!this.stripEffectsFor(target).includes(effectId)) return;
      const strip = this.state.parts[target].strip;
      if (effectId === "hpf") strip.hpf.on = enabled;
      else if (effectId === "gate") strip.gate.on = enabled;
      this.applyStripSection(target, effectId);
    }
    this.emit();
  }

  setEffectParameter(target: FxTarget, effectId: string, parameter: string, value: unknown): void {
    if (target === "master") {
      const id = effectId as EffectName;
      if (!(id in this.state.effects)) return;
      (this.state.effects[id] as Record<string, unknown>)[parameter] = value;
      this.applyMasterEffect(id);
    } else if (this.stripEffectsFor(target).includes(effectId)) {
      const strip = this.state.parts[target].strip;
      switch (effectId) {
        case "eq":
          if (parameter === "low" || parameter === "mid" || parameter === "high") strip.eq[parameter] = Number(value);
          break;
        case "hpf":
          if (parameter === "freq") strip.hpf.freq = Number(value);
          break;
        case "pan":
          if (parameter === "pan") strip.pan = Number(value);
          break;
        case "gate":
          if (parameter === "rate") strip.gate.rate = String(value);
          else if (parameter === "shape") strip.gate.shape = String(value);
          else if (parameter === "depth") strip.gate.depth = Number(value);
          break;
      }
      this.applyStripSection(target, effectId);
    }
    this.emit();
  }

  /** Reset one effect (master) or one strip section (part) to its default. */
  resetEffect(target: FxTarget, effectId: string): void {
    if (target === "master") {
      const id = effectId as EffectName;
      if (!(id in DEFAULT_EFFECTS)) return;
      (this.state.effects as unknown as Record<string, unknown>)[id] = structuredClone(DEFAULT_EFFECTS[id]);
      this.applyMasterEffect(id);
    } else {
      const strip = this.state.parts[target].strip;
      const d = DEFAULT_CHANNEL_STRIP;
      if (effectId === "eq") strip.eq = { ...d.eq };
      else if (effectId === "hpf") strip.hpf = { ...d.hpf };
      else if (effectId === "pan") strip.pan = d.pan;
      else if (effectId === "gate") strip.gate = { ...d.gate };
      this.applyStripSection(target, effectId);
    }
    this.emit();
  }

  /** Reset the master chain + all part strips to defaults. */
  resetAllEffects(): void {
    this.state.effects = structuredClone(DEFAULT_EFFECTS);
    this.state.effectOrder = [...DEFAULT_EFFECT_ORDER];
    for (const part of ["synth", "bass", "drums"] as Part[]) {
      this.state.parts[part].strip = structuredCloneStrip(DEFAULT_CHANNEL_STRIP);
    }
    this.applyFx();
    this.applyStrips();
    this.emit();
  }

  private applyPartItem(part: Part, id: string, enabled: boolean, params: Record<string, unknown>): void {
    const strip = this.state.parts[part].strip;
    switch (id) {
      case "eq":
        strip.eq = {
          low: Number(params.low ?? strip.eq.low),
          mid: Number(params.mid ?? strip.eq.mid),
          high: Number(params.high ?? strip.eq.high),
        };
        break;
      case "hpf":
        strip.hpf = { on: enabled, freq: Number(params.freq ?? strip.hpf.freq) };
        break;
      case "pan":
        strip.pan = Number(params.pan ?? strip.pan);
        break;
      case "gate":
        strip.gate = {
          on: enabled,
          rate: String(params.rate ?? strip.gate.rate),
          depth: Number(params.depth ?? strip.gate.depth),
          shape: String(params.shape ?? strip.gate.shape),
        };
        break;
    }
    this.applyStripSection(part, id);
  }

  private applyStripSection(part: Part, id: string): void {
    if (!this.engine) return;
    if (!this.stripEffectsFor(part).includes(id)) return; // skip bypassed worklet EQ/HPF
    const ch = PART_TO_AUDIO_CH[part];
    const s = this.state.parts[part].strip;
    switch (id) {
      case "eq":
        this.engine.setChannelEQ(ch, s.eq.low, s.eq.mid, s.eq.high);
        break;
      case "hpf":
        this.engine.setChannelHPF(ch, s.hpf.on ? s.hpf.freq : 20);
        break;
      case "pan":
        this.engine.setChannelPan(ch, s.pan);
        break;
      case "gate":
        this.engine.setChannelGate(ch, s.gate.on, s.gate.rate, s.gate.depth, s.gate.shape);
        break;
    }
  }

  // ── State / subscriptions ──────────────────────────────────────────────────

  getState(): SoundState {
    return mergeState(defaultSoundState(), this.state);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    this.listeners.forEach((l) => l());
  }

  // Apply the full state to a freshly created engine.
  private applyAll(): void {
    if (!this.engine) return;
    this.engine.setBpm(this.state.bpm);
    this.engine.setVolume(this.state.masterVolume);
    this.applyFx();
    for (const part of ["synth", "bass", "drums"] as Part[]) {
      this.applyPreset(part);
      this.engine.setChannelVolume(PART_TO_AUDIO_CH[part], this.state.parts[part].volume);
    }
    this.applyStrips();
  }

  private applyFx(): void {
    if (!this.engine) return;
    this.engine.setEffectOrder([...this.state.effectOrder]);
    for (const name of MASTER_EFFECTS) this.applyMasterEffect(name);
  }

  // Push one master effect to the engine. `duck` is a real sidechain (not an
  // insert effect): mpump wires it via setSidechainDuck/setDuckParams, NOT
  // setEffect — so route it correctly.
  private applyMasterEffect(id: EffectName): void {
    if (!this.engine) return;
    if (id === "duck") {
      const d = this.state.effects.duck;
      this.engine.setSidechainDuck(!!d.on);
      this.engine.setDuckParams(d.depth, d.release, d.excludeBass, d.excludeSynth);
    } else {
      this.engine.setEffect(id, { ...this.state.effects[id] });
    }
  }

  private applyStrips(): void {
    for (const part of ["synth", "bass", "drums"] as Part[]) {
      // EQ first — it self-heals the channel bus, ensuring HPF/pan/gate apply.
      for (const id of this.stripEffectsFor(part)) this.applyStripSection(part, id);
    }
  }

  // Re-send the synth/bass settings that the poly-synth worklet handles, once
  // it has loaded (drums don't use the worklet, so they're unaffected).
  private applyAfterWorklet(): void {
    if (!this.engine) return;
    for (const part of ["synth", "bass"] as Part[]) {
      this.applyPreset(part);
      this.engine.setChannelVolume(PART_TO_AUDIO_CH[part], this.state.parts[part].volume);
      for (const id of this.stripEffectsFor(part)) this.applyStripSection(part, id);
    }
  }
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/** Deep-merge a partial SoundState onto a base, preserving nested defaults. */
function mergeState(base: SoundState, patch: Partial<SoundState>): SoundState {
  const out: SoundState = {
    masterVolume: patch.masterVolume ?? base.masterVolume,
    bpm: patch.bpm ?? base.bpm,
    effects: { ...base.effects, ...(patch.effects ?? {}) } as EffectParams,
    effectOrder: patch.effectOrder ? [...patch.effectOrder] : [...base.effectOrder],
    drumMap: { ...(patch.drumMap ?? base.drumMap) },
    parts: {
      synth: mergePart(base.parts.synth, patch.parts?.synth),
      bass: mergePart(base.parts.bass, patch.parts?.bass),
      drums: mergePart(base.parts.drums, patch.parts?.drums),
    },
  };
  return out;
}

function mergePart(base: PartState, patch?: Partial<PartState>): PartState {
  if (!patch) return { preset: base.preset, volume: base.volume, strip: structuredCloneStrip(base.strip) };
  return {
    preset: patch.preset ?? base.preset,
    volume: patch.volume ?? base.volume,
    strip: {
      eq: { ...base.strip.eq, ...(patch.strip?.eq ?? {}) },
      hpf: { ...base.strip.hpf, ...(patch.strip?.hpf ?? {}) },
      pan: patch.strip?.pan ?? base.strip.pan,
      gate: { ...base.strip.gate, ...(patch.strip?.gate ?? {}) },
    },
  };
}

/**
 * Default engine = a real AudioPort, adapted to the AudioEngine interface.
 * AudioPort's module has no top-level side effects (the AudioContext is created
 * in its constructor), so the static import is safe for unit tests too — they
 * inject a fake engine and never call this factory.
 */
function defaultAudioPortEngine(): AudioEngine {
  return new AudioPort() as unknown as AudioEngine;
}
