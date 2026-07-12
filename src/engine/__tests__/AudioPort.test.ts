import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { installFakeAudioContext } from "../../test/webAudioMock";
import { AudioPort } from "../AudioPort";

// Regression coverage for the "Drums → FX off" master-volume bug: the drums
// bypass (mbDrumsDirectOut → driveGain) joins the chain AFTER the master-volume
// node (this.master), so its gain must mirror master volume or drums ignore the
// MASTER knob. Exercises the real AudioPort against a minimal Web Audio mock.
describe("AudioPort — drums obey MASTER volume when Drums→FX is off", () => {
  let restore: () => void;

  beforeEach(() => {
    vi.useFakeTimers(); // neutralize the resume heartbeat / deferred rebuild timers
    restore = installFakeAudioContext();
  });
  afterEach(() => {
    restore();
    vi.useRealTimers();
  });

  const gainOf = (port: AudioPort, field: "master" | "mbDrumsDirectOut"): number =>
    (port as unknown as Record<string, { gain: { value: number } }>)[field].gain.value;

  it("initializes the drums-direct bypass gain to the master volume", () => {
    const port = new AudioPort();
    expect(gainOf(port, "mbDrumsDirectOut")).toBe(gainOf(port, "master"));
  });

  it("keeps the bypass gain equal to master volume after setVolume", () => {
    const port = new AudioPort();
    port.setVolume(0.3);
    expect(gainOf(port, "master")).toBe(0.3);
    expect(gainOf(port, "mbDrumsDirectOut")).toBe(0.3);

    port.setVolume(0.9);
    expect(gainOf(port, "mbDrumsDirectOut")).toBe(0.9);
    expect(gainOf(port, "mbDrumsDirectOut")).toBe(gainOf(port, "master"));
  });

  it("clamps out-of-range volume identically on both nodes", () => {
    const port = new AudioPort();
    port.setVolume(5);
    expect(gainOf(port, "master")).toBe(1);
    expect(gainOf(port, "mbDrumsDirectOut")).toBe(1);

    port.setVolume(-1);
    expect(gainOf(port, "master")).toBe(0);
    expect(gainOf(port, "mbDrumsDirectOut")).toBe(0);
  });
});

// Regression coverage for the fallback sidechain-duck write model: the duck
// (applyDuck/duckRecover) writes bus.gain.value directly, so setChannelVolume
// must use the same direct .value write — mixing .value writes with scheduled
// automation (setValueAtTime) on one AudioParam is undefined-behavior territory
// and caused erratic pump when volume changed during a kick.
describe("AudioPort — setChannelVolume matches the duck's direct .value write model", () => {
  let restore: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    restore = installFakeAudioContext();
  });
  afterEach(() => {
    restore();
    vi.useRealTimers();
  });

  const busGainOf = (port: AudioPort, ch: number): { value: number; setValueAtTime: (v: number, t: number) => unknown } =>
    (port as unknown as { channelBuses: Map<number, { gain: { value: number; setValueAtTime: (v: number, t: number) => unknown } }> })
      .channelBuses.get(ch)!.gain;

  it("writes bus.gain.value directly instead of scheduling automation", () => {
    const port = new AudioPort();
    port.setChannelEQ(0, 0, 0, 0); // materializes the channel-0 bus
    const gain = busGainOf(port, 0);
    const scheduled = vi.spyOn(gain, "setValueAtTime");

    port.setChannelVolume(0, 0.55);

    expect(gain.value).toBeCloseTo(0.55);
    expect(scheduled).not.toHaveBeenCalled();
  });

  it("volume change during a fallback duck sticks after recovery", () => {
    const port = new AudioPort();
    port.setChannelEQ(0, 0, 0, 0);
    port.setSidechainDuck(true);
    port.setChannelVolume(0, 1);

    port.noteOn(9, 36, 127); // kick on the drum channel triggers the duck
    const gain = busGainOf(port, 0);
    expect(gain.value).toBeCloseTo(0.3); // ducked to 1 - depth (0.7)

    port.setChannelVolume(0, 0.5); // user moves the fader mid-duck
    expect(gain.value).toBeCloseTo(0.5);

    vi.advanceTimersByTime(200); // past duckRelease*1000 + 20 → recovery timer
    expect(gain.value).toBeCloseTo(0.5); // recovers to the NEW volume
  });
});
