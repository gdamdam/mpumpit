import { describe, it, expect } from "vitest";
import { CvGateTracker, PendingLiveNotes, type CvSink } from "../voiceQueues";

function recordingSink() {
  const events: Array<["pitch", number] | ["gate", boolean]> = [];
  const sink: CvSink = {
    setPitch: (n) => events.push(["pitch", n]),
    setGate: (on) => events.push(["gate", on]),
  };
  const lastGate = () => [...events].reverse().find((e) => e[0] === "gate")?.[1];
  const lastPitch = () => [...events].reverse().find((e) => e[0] === "pitch")?.[1];
  return { sink, events, lastGate, lastPitch };
}

describe("CvGateTracker — ref-counted CV gate", () => {
  it("keeps the gate high when one of two owners of the SAME pitch releases", () => {
    const { sink, lastGate } = recordingSink();
    const cv = new CvGateTracker(sink);
    cv.noteOn(0, 60); // synth, pitch 60
    cv.noteOn(1, 60); // bass, SAME pitch 60 — a distinct owner
    expect(cv.size).toBe(2);

    cv.noteOff(0, 60); // release synth's 60
    expect(lastGate()).toBe(true); // bass still holds 60 → gate stays high
    expect(cv.size).toBe(1);

    cv.noteOff(1, 60); // release bass's 60 — last owner
    expect(lastGate()).toBe(false);
    expect(cv.size).toBe(0);
  });

  it("channelOff(ch) clears only that channel's notes", () => {
    const { sink, lastGate, lastPitch } = recordingSink();
    const cv = new CvGateTracker(sink);
    cv.noteOn(0, 60); // synth
    cv.noteOn(1, 64); // bass

    cv.channelOff(0); // all-notes-off on synth only
    expect(lastGate()).toBe(true); // bass still holds → gate high
    expect(lastPitch()).toBe(64); // re-pitched to the remaining (bass) note
    expect(cv.size).toBe(1);

    cv.channelOff(1);
    expect(lastGate()).toBe(false);
  });

  it("uses last-note pitch priority, falling back to the newest survivor", () => {
    const { sink, lastPitch } = recordingSink();
    const cv = new CvGateTracker(sink);
    cv.noteOn(0, 60);
    cv.noteOn(0, 67);
    expect(lastPitch()).toBe(67); // newest wins
    cv.noteOff(0, 67);
    expect(lastPitch()).toBe(60); // falls back to the remaining held note
  });

  it("allOff() releases everything (global panic)", () => {
    const { sink, lastGate } = recordingSink();
    const cv = new CvGateTracker(sink);
    cv.noteOn(0, 60);
    cv.noteOn(1, 62);
    cv.allOff();
    expect(lastGate()).toBe(false);
    expect(cv.size).toBe(0);
  });

  it("clamps out-of-range / non-finite notes instead of forwarding them", () => {
    const { sink, lastPitch } = recordingSink();
    const cv = new CvGateTracker(sink);
    cv.noteOn(0, 999);
    expect(lastPitch()).toBe(127);
    cv.noteOn(0, Number.NaN);
    expect(lastPitch()).toBe(60);
  });
});

describe("PendingLiveNotes — bounded held-note queue", () => {
  it("drains held notes but never replays released ones", () => {
    const q = new PendingLiveNotes();
    q.add(0, 60, 100);
    q.add(1, 40, 90);
    q.remove(0, 60); // released before the worklet loaded → must not replay
    expect(q.drain()).toEqual([{ ch: 1, note: 40, vel: 90 }]);
    expect(q.size).toBe(0); // drain empties it
  });

  it("is bounded and refuses new keys past the limit (re-press still allowed)", () => {
    const q = new PendingLiveNotes(2);
    expect(q.add(0, 60, 100)).toBe(true);
    expect(q.add(0, 61, 100)).toBe(true);
    expect(q.add(0, 62, 100)).toBe(false); // full → dropped
    expect(q.add(0, 60, 120)).toBe(true); // re-press of an existing key: allowed, updates vel
    expect(q.size).toBe(2);
    expect(q.drain().find((n) => n.note === 60)!.vel).toBe(120);
  });

  it("clearChannel removes only that channel's queued notes", () => {
    const q = new PendingLiveNotes();
    q.add(0, 60, 100);
    q.add(1, 40, 90);
    q.clearChannel(0);
    expect(q.drain()).toEqual([{ ch: 1, note: 40, vel: 90 }]);
  });
});
