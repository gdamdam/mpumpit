// Test doubles for the Web Audio engine and Web MIDI API. AGPL-3.0-only.

import type { AudioEngine } from "../sound/SoundModule";
import type { EffectName, EffectParams, SynthParams, DrumVoiceParams } from "../engine/types";
import { DEFAULT_EFFECTS } from "../engine/types";

export interface EngineCall {
  method: string;
  args: unknown[];
}

/** Records every call; satisfies the AudioEngine interface used by SoundModule. */
export class FakeAudioEngine implements AudioEngine {
  calls: EngineCall[] = [];
  effects: EffectParams = structuredClone(DEFAULT_EFFECTS);
  order: EffectName[] = [];
  resumed = false;
  closed = false;
  // Poly-synth readiness — tests flip these to exercise degraded paths.
  polyReady = true;
  polyFailed = false;
  sidechainDuck = false;
  duckParams: { depth: number; release: number; excludeBass?: boolean; excludeSynth?: boolean } = { depth: 0.85, release: 0.04 };

  private rec(method: string, ...args: unknown[]) {
    this.calls.push({ method, args });
  }
  callsTo(method: string): EngineCall[] {
    return this.calls.filter((c) => c.method === method);
  }

  liveNoteOn(ch: number, note: number, vel: number) { this.rec("liveNoteOn", ch, note, vel); }
  liveNoteOff(ch: number, note: number) { this.rec("liveNoteOff", ch, note); }
  allNotesOff(ch: number) { this.rec("allNotesOff", ch); }
  setSynthParams(ch: number, params: SynthParams) { this.rec("setSynthParams", ch, params); }
  setDrumVoice(note: number, params: Partial<DrumVoiceParams>) { this.rec("setDrumVoice", note, params); }
  setEffect(name: EffectName, params: Record<string, unknown>) {
    this.rec("setEffect", name, params);
    Object.assign(this.effects[name], params);
  }
  getEffects(): EffectParams { return this.effects; }
  setEffectOrder(order: EffectName[]) { this.rec("setEffectOrder", order); this.order = [...order]; }
  getEffectOrder(): EffectName[] { return this.order; }
  setSidechainDuck(on: boolean) { this.rec("setSidechainDuck", on); this.sidechainDuck = on; }
  setDuckParams(depth: number, release: number, excludeBass?: boolean, excludeSynth?: boolean) {
    this.rec("setDuckParams", depth, release, excludeBass, excludeSynth);
    this.duckParams = { depth, release, excludeBass, excludeSynth };
  }
  setBpm(bpm: number) { this.rec("setBpm", bpm); }
  setChannelVolume(ch: number, v: number) { this.rec("setChannelVolume", ch, v); }
  setChannelEQ(ch: number, low: number, mid: number, high: number) { this.rec("setChannelEQ", ch, low, mid, high); }
  setChannelHPF(ch: number, freq: number) { this.rec("setChannelHPF", ch, freq); }
  setChannelPan(ch: number, pan: number) { this.rec("setChannelPan", ch, pan); }
  setChannelGate(ch: number, on: boolean, rate: string, depth: number, shape: string) {
    this.rec("setChannelGate", ch, on, rate, depth, shape);
  }
  setVolume(v: number) { this.rec("setVolume", v); }
  stopAllDrums() { this.rec("stopAllDrums"); }
  flushFxTails() { this.rec("flushFxTails"); }
  isPolySynthReady(): boolean { return this.polyReady; }
  didPolySynthFail(): boolean { return this.polyFailed; }
  getContextState(): string { return "running"; }
  async resume(): Promise<void> { this.resumed = true; this.rec("resume"); }
  close(): void { this.closed = true; this.rec("close"); }
}

// ── Fake Web MIDI ────────────────────────────────────────────────────────────

type Listener = (e: { data: Uint8Array }) => void;

export class FakeMIDIInput {
  state: "connected" | "disconnected" = "connected";
  onmidimessage: Listener | null = null;
  openShouldReject = false;
  private listeners = new Set<Listener>();

  constructor(
    public id: string,
    public name: string,
    public manufacturer = "Test",
  ) {}

  addEventListener(type: string, cb: EventListenerOrEventListenerObject) {
    if (type === "midimessage") this.listeners.add(cb as unknown as Listener);
  }
  removeEventListener(type: string, cb: EventListenerOrEventListenerObject) {
    if (type === "midimessage") this.listeners.delete(cb as unknown as Listener);
  }
  open() { return this.openShouldReject ? Promise.reject(new Error("open failed")) : Promise.resolve(this); }
  /** Simulate an inbound MIDI message (delivers to both attach styles). */
  send(bytes: number[]) {
    const data = Uint8Array.from(bytes);
    this.listeners.forEach((l) => l({ data }));
    this.onmidimessage?.({ data });
  }
  get listenerCount() { return this.listeners.size + (this.onmidimessage ? 1 : 0); }
}

export class FakeMIDIAccess {
  inputs = new Map<string, FakeMIDIInput>();
  outputs = new Map<string, never>();
  onstatechange: (() => void) | null = null;

  addInput(input: FakeMIDIInput) {
    this.inputs.set(input.id, input);
    this.onstatechange?.();
  }
  /** Mark an input disconnected and fire statechange (device unplugged). */
  disconnect(id: string) {
    const i = this.inputs.get(id);
    if (i) i.state = "disconnected";
    this.onstatechange?.();
  }
}

/**
 * Install a fake navigator.requestMIDIAccess returning `access`. Returns a
 * restore function.
 */
export function installFakeMidi(access: FakeMIDIAccess): () => void {
  const original = (navigator as unknown as { requestMIDIAccess?: unknown }).requestMIDIAccess;
  (navigator as unknown as { requestMIDIAccess: unknown }).requestMIDIAccess = () => Promise.resolve(access);
  return () => {
    (navigator as unknown as { requestMIDIAccess?: unknown }).requestMIDIAccess = original;
  };
}
