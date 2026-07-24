// Minimal Web Audio API mock for unit-testing AudioPort's node graph under
// jsdom (which has no AudioContext). It covers only what AudioPort's constructor
// and setVolume touch — it is NOT a faithful audio engine and no signal flows.
//
// Design: ONE universal node (a Proxy) stands in for every node type. Method
// calls (connect/disconnect/start/stop) are no-ops; reading any other property
// lazily returns a stable AudioParam (so `.gain.value = x` then reading it back
// works); assignments store scalars (type, fftSize, curve, …). createBuffer
// returns a real AudioBuffer-shaped object so drumSynth can fill Float32Arrays.
// Original work — AGPL-3.0-only.

class FakeAudioParam {
  value = 0;
  setValueAtTime(v: number) { this.value = v; return this; }
  setTargetAtTime(v: number) { this.value = v; return this; }
  linearRampToValueAtTime(v: number) { this.value = v; return this; }
  exponentialRampToValueAtTime(v: number) { this.value = v; return this; }
  setValueCurveAtTime() { return this; }
  cancelScheduledValues() { return this; }
  cancelAndHoldAtTime() { return this; }
}

const NODE_METHODS = new Set(["connect", "disconnect", "start", "stop"]);

/** A universal audio node. Same Proxy backs Gain/Biquad/Compressor/Delay/etc. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeNode(): any {
  const scalars: Record<string, unknown> = {};
  const params: Record<string, FakeAudioParam> = {};
  const port = { postMessage() {}, onmessage: null };
  return new Proxy({} as Record<string, unknown>, {
    get(_t, prop) {
      if (typeof prop !== "string") return undefined;
      if (prop === "port") return port;
      if (prop in scalars) return scalars[prop];
      if (NODE_METHODS.has(prop)) return (dest: unknown) => dest; // connect → returns destination
      return (params[prop] ??= new FakeAudioParam());
    },
    set(_t, prop, value) { scalars[prop as string] = value; return true; },
  });
}

/** Fake AudioWorkletNode: records constructor options and connect/postMessage
 *  calls so tests can assert the output-count contract and Out2/split plumbing
 *  (AudioPort's `numberOfOutputs`, `setWorkletOut2`, `setWorkletSplit(1|2, …)`)
 *  without a real audio thread. Opt-in via installFakeAudioContext({ worklet: true }) —
 *  see fakeWorkletEnabled below. */
export class FakeAudioWorkletNode {
  numberOfInputs: number;
  numberOfOutputs: number;
  outputChannelCount: number[];
  /** Every connect(dest, output) call, recorded as [dest, outputIndex]. */
  connects: Array<[unknown, number]> = [];
  port: {
    messages: Array<Record<string, unknown>>;
    onmessage: ((e: unknown) => void) | null;
    postMessage: (msg: Record<string, unknown>) => void;
  };

  constructor(_ctx: unknown, _name: string, options?: { numberOfInputs?: number; numberOfOutputs?: number; outputChannelCount?: number[] }) {
    this.numberOfInputs = options?.numberOfInputs ?? 1;
    this.numberOfOutputs = options?.numberOfOutputs ?? 1;
    this.outputChannelCount = options?.outputChannelCount ?? [2];
    const messages: Array<Record<string, unknown>> = [];
    this.port = {
      messages,
      onmessage: null,
      postMessage: (msg: Record<string, unknown>) => { messages.push(msg); },
    };
  }

  connect(dest: unknown, output = 0): unknown {
    this.connects.push([dest, output]);
    return dest;
  }

  disconnect(dest?: unknown, output?: number): void {
    if (dest === undefined) { this.connects = []; return; }
    this.connects = this.connects.filter(([d, o]) => !(d === dest && (output === undefined || o === output)));
  }
}

/** Module-level switch: when true, FakeAudioContext.audioWorklet is present
 *  (so AudioPort's loadWorklets() proceeds) and window.AudioWorkletNode is the
 *  fake above. Off by default — existing tests rely on polySynth staying null. */
let fakeWorkletEnabled = false;

function makeBuffer(channels: number, length: number, sampleRate: number) {
  const ch = Math.max(1, channels);
  const data = Array.from({ length: ch }, () => new Float32Array(length));
  return {
    numberOfChannels: ch, length, sampleRate, duration: length / sampleRate,
    getChannelData: (i: number) => data[i] ?? data[0],
    copyFromChannel() {}, copyToChannel() {},
  };
}

export class FakeAudioContext {
  currentTime = 0;
  sampleRate = 48000;
  state: "running" | "suspended" | "closed" = "running";
  destination = makeNode();
  onstatechange: (() => void) | null = null;
  // Undefined by default: AudioPort.loadWorklets() bails via failPolySynth() when
  // audioWorklet is falsy, so most tests needn't mock AudioWorkletNode at all.
  // installFakeAudioContext({ worklet: true }) flips fakeWorkletEnabled so this
  // getter returns a stub addModule, letting loadWorklets() proceed to construct
  // the (also faked) AudioWorkletNode.
  get audioWorklet(): { addModule: () => Promise<void> } | undefined {
    return fakeWorkletEnabled ? { addModule: () => Promise.resolve() } : undefined;
  }
  constructor(_opts?: unknown) {}
  createGain() { return makeNode(); }
  createBiquadFilter() { return makeNode(); }
  createDynamicsCompressor() { return makeNode(); }
  createWaveShaper() { return makeNode(); }
  createAnalyser() { return makeNode(); }
  createStereoPanner() { return makeNode(); }
  createPanner() { return makeNode(); }
  createDelay() { return makeNode(); }
  createConvolver() { return makeNode(); }
  createOscillator() { return makeNode(); }
  createConstantSource() { return makeNode(); }
  createBufferSource() { return makeNode(); }
  createChannelSplitter() { return makeNode(); }
  createChannelMerger() { return makeNode(); }
  createPeriodicWave() { return makeNode(); }
  createBuffer(channels: number, length: number, sampleRate: number) { return makeBuffer(channels, length, sampleRate); }
  decodeAudioData() { return Promise.resolve(makeBuffer(2, 1, this.sampleRate)); }
  resume() { return Promise.resolve(); }
  suspend() { return Promise.resolve(); }
  close() { return Promise.resolve(); }
}

/** Install FakeAudioContext as window.AudioContext/webkitAudioContext.
 *  Pass `{ worklet: true }` to also enable `ctx.audioWorklet` and register a fake
 *  `window.AudioWorkletNode`, letting AudioPort's poly-synth worklet "load" and
 *  its output[0..2]/split plumbing become exercisable in tests. Default (no
 *  options) preserves prior behavior: audioWorklet is undefined, polySynth stays
 *  null, existing tests are unaffected. Returns a restore function. */
export function installFakeAudioContext(opts?: { worklet?: boolean }): () => void {
  const w = window as unknown as Record<string, unknown>;
  const prevAC = w.AudioContext;
  const prevWk = w.webkitAudioContext;
  const prevAWN = w.AudioWorkletNode;
  const prevWorkletEnabled = fakeWorkletEnabled;
  w.AudioContext = FakeAudioContext;
  w.webkitAudioContext = FakeAudioContext;
  fakeWorkletEnabled = !!opts?.worklet;
  if (opts?.worklet) w.AudioWorkletNode = FakeAudioWorkletNode;
  return () => {
    w.AudioContext = prevAC;
    w.webkitAudioContext = prevWk;
    w.AudioWorkletNode = prevAWN;
    fakeWorkletEnabled = prevWorkletEnabled;
  };
}
