import { describe, it, expect, beforeEach } from "vitest";
import { QwertyKeyboard, QWERTY_SEMITONES } from "../qwerty";

function makeKb() {
  const ons: Array<[number, number]> = [];
  const offs: number[] = [];
  const kb = new QwertyKeyboard({
    onNoteOn: (n, v) => ons.push([n, v]),
    onNoteOff: (n) => offs.push(n),
    baseNote: 60,
  });
  kb.setEnabled(true);
  return { kb, ons, offs };
}

describe("QwertyKeyboard (Ableton layout)", () => {
  let kb: QwertyKeyboard, ons: Array<[number, number]>, offs: number[];
  beforeEach(() => { ({ kb, ons, offs } = makeKb()); });

  it("maps the home row to a chromatic octave from the base note", () => {
    kb.handleKeyDown("a");
    kb.handleKeyDown("s");
    kb.handleKeyDown("k");
    expect(ons.map(([n]) => n)).toEqual([60, 62, 72]); // C, D, C(+1 oct)
  });

  it("does nothing when disabled", () => {
    kb.setEnabled(false);
    expect(kb.handleKeyDown("a")).toBe(false);
    expect(ons).toHaveLength(0);
  });

  it("ignores auto-repeat and re-press while held", () => {
    kb.handleKeyDown("a", false);
    kb.handleKeyDown("a", true); // repeat
    kb.handleKeyDown("a", false); // already held
    expect(ons).toHaveLength(1);
  });

  it("releases the exact note on key up", () => {
    kb.handleKeyDown("a");
    kb.handleKeyUp("a");
    expect(offs).toEqual([60]);
  });

  it("z/x shift the octave; held notes release on shift", () => {
    kb.handleKeyDown("a"); // 60
    kb.handleKeyDown("x"); // octave up, releases held 'a'
    expect(offs).toEqual([60]);
    kb.handleKeyDown("a"); // now 72
    expect(ons.map(([n]) => n)).toEqual([60, 72]);
    expect(kb.getOctaveShift()).toBe(1);
  });

  it("c/v change velocity within 1..127", () => {
    kb.handleKeyDown("c"); // -12 => 88
    expect(kb.getVelocity()).toBe(88);
    kb.handleKeyDown("a");
    expect(ons[0][1]).toBe(88);
  });

  it("releaseAll sends note-off for everything sounding", () => {
    kb.handleKeyDown("a");
    kb.handleKeyDown("s");
    kb.releaseAll();
    expect(offs.sort()).toEqual([60, 62]);
  });

  it("covers a full Ableton-style key set", () => {
    expect(Object.keys(QWERTY_SEMITONES)).toContain(";");
    expect(QWERTY_SEMITONES.a).toBe(0);
    expect(QWERTY_SEMITONES.j).toBe(11);
  });

  it("getRootNote reflects base + octave shift", () => {
    expect(kb.getRootNote()).toBe(60);
    kb.handleKeyDown("x"); // octave up
    expect(kb.getRootNote()).toBe(72);
  });

  it("drum mode maps the white row to drum voices and ignores octave", () => {
    kb.setDrumMode(true);
    kb.handleKeyDown("a"); // kick
    kb.handleKeyDown("d"); // snare
    kb.handleKeyDown("z"); // octave shift — no-op in drum mode
    kb.handleKeyDown("s"); // rim (unchanged by z)
    expect(ons.map(([n]) => n)).toEqual([36, 38, 37]);
    expect(kb.isDrumMode()).toBe(true);
  });

  it("drum mode ignores chromatic black keys", () => {
    kb.setDrumMode(true);
    expect(kb.handleKeyDown("w")).toBe(true); // consumed, but no voice
    expect(ons).toHaveLength(0);
  });
});
