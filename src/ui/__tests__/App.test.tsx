import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act, cleanup } from "@testing-library/react";
import { App } from "../App";
import { FakeAudioEngine, FakeMIDIAccess, FakeMIDIInput, installFakeMidi } from "../../test/mocks";

describe("App — end to end with mocked Web MIDI + Web Audio", () => {
  let engine: FakeAudioEngine;
  let access: FakeMIDIAccess;
  let input: FakeMIDIInput;
  let restore: () => void;

  beforeEach(() => {
    localStorage.clear();
    engine = new FakeAudioEngine();
    access = new FakeMIDIAccess();
    input = new FakeMIDIInput("ctrl", "Test Controller");
    access.inputs.set(input.id, input);
    restore = installFakeMidi(access);
  });

  afterEach(() => {
    cleanup();
    restore();
  });

  it("lists inputs, starts audio, routes channels to parts, and panics", async () => {
    render(<App createEngine={() => engine} />);

    // MIDI granted → the input selector shows the device.
    await screen.findByRole("option", { name: "Test Controller" });

    // Start audio (browser autoplay gate).
    fireEvent.click(screen.getByRole("button", { name: /Start Audio/i }));
    await waitFor(() => expect(screen.queryByRole("button", { name: /Start Audio/i })).toBeNull());

    // Route notes: ch1→synth(0), ch2→bass(1), ch10→drums(9 / kick 36).
    await act(async () => {
      input.send([0x90, 60, 100]); // synth
      input.send([0x91, 40, 90]); // bass
      input.send([0x99, 36, 110]); // drums
    });

    const ons = engine.callsTo("liveNoteOn").map((c) => c.args);
    expect(ons).toContainEqual([0, 60, 100]);
    expect(ons).toContainEqual([1, 40, 90]);
    expect(ons).toContainEqual([9, 36, 110]);

    // Note Off releases the synth voice.
    await act(async () => { input.send([0x80, 60, 0]); });
    expect(engine.callsTo("liveNoteOff").map((c) => c.args)).toContainEqual([0, 60]);

    // PANIC silences every part: synth/bass voices off + drum one-shots stopped.
    fireEvent.click(screen.getByRole("button", { name: "PANIC" }));
    expect(engine.callsTo("allNotesOff").map((c) => c.args[0])).toEqual(expect.arrayContaining([0, 1]));
    expect(engine.callsTo("stopAllDrums").length).toBeGreaterThan(0);
  });

  it("queues MIDI received before audio starts, then flushes on start", async () => {
    render(<App createEngine={() => engine} />);
    await screen.findByRole("option", { name: "Test Controller" });

    // Note arrives BEFORE Start Audio — must be queued, not dropped.
    await act(async () => { input.send([0x90, 64, 100]); });
    expect(engine.callsTo("liveNoteOn")).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: /Start Audio/i }));
    await waitFor(() => expect(engine.callsTo("liveNoteOn").map((c) => c.args)).toContainEqual([0, 64, 100]));
  });

  it("plays the target part from the computer keyboard", async () => {
    render(<App createEngine={() => engine} />);
    await screen.findByRole("option", { name: "Test Controller" });
    fireEvent.click(screen.getByRole("button", { name: /Start Audio/i }));
    await waitFor(() => expect(screen.queryByRole("button", { name: /Start Audio/i })).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: /Keys/i })); // enable QWERTY → synth

    await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" })); });
    expect(engine.callsTo("liveNoteOn").map((c) => c.args)).toContainEqual([0, 60, 100]); // 'a' = middle C → synth

    await act(async () => { window.dispatchEvent(new KeyboardEvent("keyup", { key: "a" })); });
    expect(engine.callsTo("liveNoteOff").map((c) => c.args)).toContainEqual([0, 60]);
  });

  it("persists settings (channel edit) across remounts", async () => {
    const { unmount } = render(<App createEngine={() => engine} />);
    await screen.findByRole("option", { name: "Test Controller" });

    const synthCh = screen.getAllByLabelText(/Incoming MIDI channel/i)[0];
    fireEvent.change(synthCh, { target: { value: "5" } });

    await waitFor(() => {
      const raw = localStorage.getItem("mpumpit.settings.v1");
      expect(raw && JSON.parse(raw).channels.synth).toBe(5);
    });

    unmount();
    const engine2 = new FakeAudioEngine();
    render(<App createEngine={() => engine2} />);
    await screen.findByRole("option", { name: "Test Controller" });
    const synthCh2 = screen.getAllByLabelText(/Incoming MIDI channel/i)[0] as HTMLInputElement;
    expect(synthCh2.value).toBe("5");
  });
});
