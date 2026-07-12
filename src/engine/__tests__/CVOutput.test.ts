import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { FakeAudioContext } from "../../test/webAudioMock";
import { CVOutput } from "../CVOutput";

// Exercises CVOutput against the minimal Web Audio mock. Covers:
// - pitch CV clamping to the ±1.0 float range (notes ≥121 saturate at 1.0
//   instead of writing out-of-range values)
// - re-enable restoring the held note's gate/pitch (disable zeroes both
//   offsets; re-enable must re-assert them or a held note stays silent)
describe("CVOutput", () => {
  let ctx: FakeAudioContext;
  let cv: CVOutput;

  beforeEach(() => {
    vi.useFakeTimers();
    ctx = new FakeAudioContext();
    cv = new CVOutput(ctx as unknown as AudioContext);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const offsets = (): { pitch: number; gate: number; master: number } => {
    const c = cv as unknown as {
      pitchSource: { offset: { value: number } };
      gateSource: { offset: { value: number } };
      masterGain: { gain: { value: number } };
    };
    return {
      pitch: c.pitchSource.offset.value,
      gate: c.gateSource.offset.value,
      master: c.masterGain.gain.value,
    };
  };

  describe("pitch CV clamping", () => {
    it("outputs 0 for MIDI note 60 (C4 = 0V)", () => {
      cv.setEnabled(true);
      cv.setPitch(60);
      expect(offsets().pitch).toBe(0);
    });

    it("clamps note 127 to exactly 1.0 instead of exceeding the float range", () => {
      cv.setEnabled(true);
      cv.setPitch(127);
      expect(offsets().pitch).toBe(1.0);
    });

    it("saturates note 121 at 1.0 (documented +5V ceiling)", () => {
      cv.setEnabled(true);
      cv.setPitch(121);
      expect(offsets().pitch).toBe(1.0);
    });

    it("outputs -1.0 for MIDI note 0 (lower bound)", () => {
      cv.setEnabled(true);
      cv.setPitch(0);
      expect(offsets().pitch).toBe(-1.0);
    });
  });

  describe("re-enable restores held note", () => {
    it("re-asserts gate and pitch of a held note after disable → enable", () => {
      cv.setEnabled(true);
      cv.setPitch(72); // 1V → 0.2
      cv.setGate(true);
      expect(offsets()).toEqual({ pitch: 0.2, gate: 1.0, master: 1 });

      cv.setEnabled(false);
      expect(offsets()).toEqual({ pitch: 0, gate: 0, master: 0 });

      cv.setEnabled(true);
      expect(offsets()).toEqual({ pitch: 0.2, gate: 1.0, master: 1 });
    });

    it("does not re-assert a gate that was released while disabled", () => {
      cv.setEnabled(true);
      cv.setPitch(72);
      cv.setGate(true);
      cv.setEnabled(false);
      cv.setGate(false); // note-off arrives while disabled

      cv.setEnabled(true);
      expect(offsets().gate).toBe(0);
    });
  });
});
