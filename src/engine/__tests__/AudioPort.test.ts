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
