import { describe, it, expect } from "vitest";
import { parseMidiMessage } from "../parse";

describe("parseMidiMessage", () => {
  it("decodes Note On with channel and velocity", () => {
    expect(parseMidiMessage([0x90, 60, 100])).toEqual({ kind: "noteOn", channel: 1, note: 60, velocity: 100 });
  });

  it("extracts channel from the status nibble (1–16)", () => {
    expect(parseMidiMessage([0x91, 60, 100])).toMatchObject({ channel: 2 });
    expect(parseMidiMessage([0x99, 36, 100])).toMatchObject({ channel: 10 });
    expect(parseMidiMessage([0x9f, 60, 100])).toMatchObject({ channel: 16 });
  });

  it("treats Note On with velocity 0 as Note Off", () => {
    expect(parseMidiMessage([0x90, 60, 0])).toEqual({ kind: "noteOff", channel: 1, note: 60 });
  });

  it("decodes Note Off (0x80)", () => {
    expect(parseMidiMessage([0x80, 64, 40])).toEqual({ kind: "noteOff", channel: 1, note: 64 });
  });

  it("maps CC 120 and 123 to allNotesOff", () => {
    expect(parseMidiMessage([0xb0, 123, 0])).toEqual({ kind: "allNotesOff", channel: 1, controller: 123 });
    expect(parseMidiMessage([0xb9, 120, 0])).toEqual({ kind: "allNotesOff", channel: 10, controller: 120 });
  });

  it("ignores other Control Change messages", () => {
    expect(parseMidiMessage([0xb0, 7, 100])).toEqual({ kind: "ignored" });
  });

  it("treats system real-time (clock/start/stop) as clock, never erroring", () => {
    for (const status of [0xf8, 0xfa, 0xfb, 0xfc, 0xfe, 0xff]) {
      expect(parseMidiMessage([status])).toEqual({ kind: "clock" });
    }
  });

  it("ignores system common / SysEx, program change, pitch bend, aftertouch", () => {
    expect(parseMidiMessage([0xf0, 1, 2, 0xf7])).toEqual({ kind: "ignored" });
    expect(parseMidiMessage([0xc0, 5])).toEqual({ kind: "ignored" });
    expect(parseMidiMessage([0xe0, 0, 64])).toEqual({ kind: "ignored" });
    expect(parseMidiMessage([0xa0, 60, 10])).toEqual({ kind: "ignored" });
  });

  it("ignores empty messages", () => {
    expect(parseMidiMessage([])).toEqual({ kind: "ignored" });
    expect(parseMidiMessage(new Uint8Array())).toEqual({ kind: "ignored" });
  });

  it("accepts Uint8Array (the Web MIDI payload type)", () => {
    expect(parseMidiMessage(Uint8Array.from([0x90, 60, 1]))).toEqual({ kind: "noteOn", channel: 1, note: 60, velocity: 1 });
  });

  it("ignores a buffer that starts with a data byte (not a status byte)", () => {
    // High bit clear → not a status byte; must not be misparsed as a message type.
    expect(parseMidiMessage([0x3c, 0x40])).toEqual({ kind: "ignored" });
    expect(parseMidiMessage([0x00, 0x00])).toEqual({ kind: "ignored" });
    expect(parseMidiMessage([0x7f])).toEqual({ kind: "ignored" });
  });

  it("treats high-rate system-common timing (MTC 0xF1, song-position 0xF2) as clock so it can be throttled", () => {
    expect(parseMidiMessage([0xf1, 0x10])).toEqual({ kind: "clock" });
    expect(parseMidiMessage([0xf2, 0x00, 0x10])).toEqual({ kind: "clock" });
  });

  it("masks data bytes to 7 bits (defensive against malformed drivers)", () => {
    // 0xc4 = 196 → 196 & 0x7f = 68
    expect(parseMidiMessage([0x90, 0xc4, 100])).toMatchObject({ kind: "noteOn", note: 68 });
  });
});
