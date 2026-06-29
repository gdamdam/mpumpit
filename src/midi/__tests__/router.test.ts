import { describe, it, expect, beforeEach } from "vitest";
import { MidiRouter, ALL_INPUTS, type NoteSink } from "../router";
import type { Part } from "../types";
import { FakeMIDIAccess, FakeMIDIInput, installFakeMidi } from "../../test/mocks";

class RecordingSink implements NoteSink {
  ons: Array<[Part, number, number]> = [];
  offs: Array<[Part, number]> = [];
  panics = 0;
  noteOn(p: Part, n: number, v: number) { this.ons.push([p, n, v]); }
  noteOff(p: Part, n: number) { this.offs.push([p, n]); }
  panic() { this.panics++; }
}

const noteOn = (ch: number, n: number, v = 100) => [0x90 | (ch - 1), n, v];
const noteOff = (ch: number, n: number) => [0x80 | (ch - 1), n, 0];

describe("MidiRouter — channel routing", () => {
  let sink: RecordingSink;
  let router: MidiRouter;
  beforeEach(() => {
    sink = new RecordingSink();
    router = new MidiRouter({ sink });
  });

  it("routes channels 1/2/10 to synth/bass/drums", () => {
    router.handleMessage("in", noteOn(1, 60));
    router.handleMessage("in", noteOn(2, 40));
    router.handleMessage("in", noteOn(10, 36));
    expect(sink.ons).toEqual([["synth", 60, 100], ["bass", 40, 100], ["drums", 36, 100]]);
  });

  it("ignores notes on unrouted channels", () => {
    router.handleMessage("in", noteOn(5, 60));
    expect(sink.ons).toHaveLength(0);
  });

  it("respects editable channel routing", () => {
    router.setChannels({ synth: 5 });
    router.handleMessage("in", noteOn(5, 60));
    expect(sink.ons).toEqual([["synth", 60, 100]]);
  });

  it("passes velocity through", () => {
    router.handleMessage("in", noteOn(1, 60, 42));
    expect(sink.ons[0][2]).toBe(42);
  });

  it("signals raw MIDI activity even on an unrouted channel", () => {
    let raw = 0;
    const r = new MidiRouter({ sink: new RecordingSink(), onRawActivity: () => raw++ });
    r.handleMessage("in", noteOn(7, 60)); // channel 7 maps to no part
    expect(raw).toBe(1); // MIDI-IN still blinks → device is sending
  });
});

describe("MidiRouter — note lifecycle & ownership", () => {
  let sink: RecordingSink;
  let router: MidiRouter;
  beforeEach(() => {
    sink = new RecordingSink();
    router = new MidiRouter({ sink });
  });

  it("matches Note Off to its Note On", () => {
    router.handleMessage("in", noteOn(1, 60));
    router.handleMessage("in", noteOff(1, 60));
    expect(sink.offs).toEqual([["synth", 60]]);
    expect(router.activeVoiceCount).toBe(0);
  });

  it("treats Note On velocity 0 as Note Off", () => {
    router.handleMessage("in", noteOn(1, 60));
    router.handleMessage("in", noteOn(1, 60, 0));
    expect(sink.offs).toEqual([["synth", 60]]);
  });

  it("ignores a late/unmatched Note Off (no hung note)", () => {
    router.handleMessage("in", noteOff(1, 60));
    expect(sink.offs).toHaveLength(0);
  });

  it("collapses duplicate Note Ons to a single voice + single Note Off", () => {
    router.handleMessage("in", noteOn(1, 60));
    router.handleMessage("in", noteOn(1, 60)); // retrigger
    expect(sink.ons).toHaveLength(2);
    router.handleMessage("in", noteOff(1, 60));
    expect(sink.offs).toEqual([["synth", 60]]);
    expect(router.activeVoiceCount).toBe(0);
  });

  it("ref-counts a voice shared by two inputs (last release wins)", () => {
    router.handleMessage("A", noteOn(1, 60));
    router.handleMessage("B", noteOn(1, 60));
    expect(router.activeVoiceCount).toBe(1);
    router.handleMessage("A", noteOff(1, 60));
    expect(sink.offs).toHaveLength(0); // B still holds it
    router.handleMessage("B", noteOff(1, 60));
    expect(sink.offs).toEqual([["synth", 60]]);
  });
});

describe("MidiRouter — panic & cleanup", () => {
  let sink: RecordingSink;
  let router: MidiRouter;
  beforeEach(() => {
    sink = new RecordingSink();
    router = new MidiRouter({ sink });
  });

  it("panic releases all notes and signals the sink", () => {
    router.handleMessage("in", noteOn(1, 60));
    router.handleMessage("in", noteOn(2, 40));
    router.panic();
    expect(sink.offs.sort()).toEqual([["bass", 40], ["synth", 60]].sort());
    expect(sink.panics).toBe(1);
    expect(router.activeVoiceCount).toBe(0);
  });

  it("CC 123 (all notes off) releases that input's notes on the channel", () => {
    router.handleMessage("in", noteOn(1, 60));
    router.handleMessage("in", [0xb0, 123, 0]);
    expect(sink.offs).toEqual([["synth", 60]]);
  });

  it("releases all notes when channels change", () => {
    router.handleMessage("in", noteOn(1, 60));
    router.setChannels({ synth: 3 });
    expect(sink.offs).toEqual([["synth", 60]]);
  });

  it("releases a single part on demand (e.g. preset change)", () => {
    router.handleMessage("in", noteOn(1, 60));
    router.handleMessage("in", noteOn(2, 40));
    router.releasePart("synth");
    expect(sink.offs).toEqual([["synth", 60]]);
    expect(router.activeVoiceCount).toBe(1);
  });

  it("ignores MIDI clock without error or notes", () => {
    expect(() => router.handleMessage("in", [0xf8])).not.toThrow();
    router.handleMessage("in", [0xfa]);
    router.handleMessage("in", [0xfc]);
    expect(sink.ons).toHaveLength(0);
    expect(sink.offs).toHaveLength(0);
  });
});

describe("MidiRouter — drum compatibility routing", () => {
  it("routes midip drum notes (incl. 56) to playable mpump voices", () => {
    const sink = new RecordingSink();
    const router = new MidiRouter({ sink });
    for (const n of [36, 47, 50, 56]) router.handleMessage("in", noteOn(10, n));
    expect(sink.ons.map(([p, n]) => [p, n])).toEqual([
      ["drums", 36], ["drums", 47], ["drums", 50], ["drums", 56],
    ]);
  });

  it("drops drum notes with no mpump voice", () => {
    const sink = new RecordingSink();
    const router = new MidiRouter({ sink });
    router.handleMessage("in", noteOn(10, 99));
    expect(sink.ons).toHaveLength(0);
  });

  it("applies drum-map overrides", () => {
    const sink = new RecordingSink();
    const router = new MidiRouter({ sink, drumMap: { 47: 38 } });
    router.handleMessage("in", noteOn(10, 47));
    expect(sink.ons).toEqual([["drums", 38, 100]]);
  });
});

describe("MidiRouter — Web MIDI access, hot-plug & input selection", () => {
  let sink: RecordingSink;
  let access: FakeMIDIAccess;
  let restore: () => void;

  beforeEach(() => {
    sink = new RecordingSink();
    access = new FakeMIDIAccess();
    restore = installFakeMidi(access);
  });

  it("grants access and listens to all inputs by default (no duplicate events)", async () => {
    const a = new FakeMIDIInput("a", "Controller A");
    const b = new FakeMIDIInput("b", "Controller B");
    access.addInput(a);
    access.addInput(b);
    const router = new MidiRouter({ sink });
    expect(await router.enable()).toBe("granted");
    a.send(noteOn(1, 60));
    b.send(noteOn(1, 61));
    expect(sink.ons).toEqual([["synth", 60, 100], ["synth", 61, 100]]); // each once
    restore();
  });

  it("listens only to the selected input", async () => {
    const a = new FakeMIDIInput("a", "A");
    const b = new FakeMIDIInput("b", "B");
    access.addInput(a); access.addInput(b);
    const router = new MidiRouter({ sink, selectedInputId: "a" });
    await router.enable();
    b.send(noteOn(1, 60));
    expect(sink.ons).toHaveLength(0);
    a.send(noteOn(1, 60));
    expect(sink.ons).toHaveLength(1);
    restore();
  });

  it("releases notes and detaches when a device disconnects (hot-unplug)", async () => {
    const a = new FakeMIDIInput("a", "A");
    access.addInput(a);
    const router = new MidiRouter({ sink });
    await router.enable();
    a.send(noteOn(1, 60));
    expect(router.activeVoiceCount).toBe(1);
    access.disconnect("a");
    expect(sink.offs).toEqual([["synth", 60]]); // cleaned up immediately
    expect(a.listenerCount).toBe(0); // listener removed
    restore();
  });

  it("releases held notes when the selected input changes", async () => {
    const a = new FakeMIDIInput("a", "A");
    const b = new FakeMIDIInput("b", "B");
    access.addInput(a); access.addInput(b);
    const router = new MidiRouter({ sink, selectedInputId: "a" });
    await router.enable();
    a.send(noteOn(1, 60));
    router.setSelectedInput("b");
    expect(sink.offs).toEqual([["synth", 60]]);
    restore();
  });

  it("reports unsupported when Web MIDI is unavailable", async () => {
    const original = (navigator as unknown as { requestMIDIAccess?: unknown }).requestMIDIAccess;
    delete (navigator as unknown as { requestMIDIAccess?: unknown }).requestMIDIAccess;
    const router = new MidiRouter({ sink });
    expect(await router.enable()).toBe("unsupported");
    (navigator as unknown as { requestMIDIAccess?: unknown }).requestMIDIAccess = original;
    restore();
  });
});
