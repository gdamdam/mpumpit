import { describe, it, expect } from "vitest";
import {
  DEFAULT_DRUM_MAP, MIDIP_DRUM_LANES, MPUMP_PLAYABLE_DRUM_NOTES, mapDrumNote,
} from "../drumMap";

const MIDIP_NOTES = [36, 37, 38, 42, 46, 47, 49, 50, 51, 56];

describe("drum compatibility map", () => {
  it("covers exactly the 10 midip drum lanes", () => {
    expect(Object.keys(MIDIP_DRUM_LANES).map(Number).sort((a, b) => a - b)).toEqual(MIDIP_NOTES);
  });

  it("every midip lane resolves to a playable mpump voice (no silent notes)", () => {
    for (const note of MIDIP_NOTES) {
      const mapped = mapDrumNote(note);
      expect(mapped).not.toBeNull();
      expect(MPUMP_PLAYABLE_DRUM_NOTES.has(mapped!)).toBe(true);
    }
  });

  it("default map is identity for all midip lanes", () => {
    for (const note of MIDIP_NOTES) expect(DEFAULT_DRUM_MAP[note]).toBe(note);
  });

  it("note 56 (cowbell) is playable — mpump's hidden 10th voice", () => {
    expect(mapDrumNote(56)).toBe(56);
  });

  it("honours user overrides", () => {
    // Remap midip's mid-tom (47) onto the snare (38).
    expect(mapDrumNote(47, { 47: 38 })).toBe(38);
  });

  it("returns null when a (possibly remapped) note has no mpump voice", () => {
    expect(mapDrumNote(99)).toBeNull();
    expect(mapDrumNote(36, { 36: 200 })).toBeNull();
  });
});
