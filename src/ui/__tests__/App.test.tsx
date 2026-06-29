import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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
    expect(engine.callsTo("liveNoteOn").map((c) => c.args)).toContainEqual([0, 48, 100]); // 'a' = C3 → synth

    await act(async () => { window.dispatchEvent(new KeyboardEvent("keyup", { key: "a" })); });
    expect(engine.callsTo("liveNoteOff").map((c) => c.args)).toContainEqual([0, 48]);
  });

  it("retargets the keyboard to bass and drums (and keys win over a focused select)", async () => {
    render(<App createEngine={() => engine} />);
    await screen.findByRole("option", { name: "Test Controller" });
    fireEvent.click(screen.getByRole("button", { name: /Start Audio/i }));
    await waitFor(() => expect(screen.queryByRole("button", { name: /Start Audio/i })).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: /Keys/i }));

    const target = screen.getByLabelText("Keyboard target part");

    // Bass: melodic C3 (48) on the bass channel (engine ch 1).
    fireEvent.change(target, { target: { value: "bass" } });
    await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" })); });
    expect(engine.callsTo("liveNoteOn").map((c) => c.args)).toContainEqual([1, 48, 100]);
    await act(async () => { window.dispatchEvent(new KeyboardEvent("keyup", { key: "a" })); });

    // Drums: 'a' becomes the kick (36) on the drums channel (engine ch 9).
    fireEvent.change(target, { target: { value: "drums" } });
    await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" })); });
    expect(engine.callsTo("liveNoteOn").map((c) => c.args)).toContainEqual([9, 36, 100]);
  });

  it("direct keyboard honors the explicit target; Over MIDI layers through routing (P2)", async () => {
    // A drum-map override: incoming MIDI note 36 → 38. Direct routing must NOT
    // apply it (A stays kick); Over-MIDI routing must (it goes through routing).
    localStorage.setItem("mpumpit.settings.v1", JSON.stringify({
      soundState: { drumMap: { 36: 38 } },
      channels: { synth: 1, bass: 2, drums: 10 },
      selectedInputId: "all",
    }));
    render(<App createEngine={() => engine} />);
    await screen.findByRole("option", { name: "Test Controller" });
    fireEvent.click(screen.getByRole("button", { name: /Start Audio/i }));
    await waitFor(() => expect(screen.queryByRole("button", { name: /Start Audio/i })).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: /Keys/i }));
    fireEvent.change(screen.getByLabelText("Keyboard target part"), { target: { value: "drums" } });

    // Direct (default): 'a' = kick (36) reaches drums directly; drum-map skipped.
    await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" })); });
    expect(engine.callsTo("liveNoteOn").map((c) => c.args)).toContainEqual([9, 36, 100]);
    await act(async () => { window.dispatchEvent(new KeyboardEvent("keyup", { key: "a" })); });

    // Over MIDI: same key now flows through routing + drum-map → voice 38.
    fireEvent.click(screen.getByRole("button", { name: "Over MIDI" }));
    await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" })); });
    expect(engine.callsTo("liveNoteOn").map((c) => c.args)).toContainEqual([9, 38, 100]);
  });

  it("opens the sound editor, auditions a note, and returns", async () => {
    render(<App createEngine={() => engine} />);
    await screen.findByRole("option", { name: "Test Controller" });
    fireEvent.click(screen.getByRole("button", { name: /Start Audio/i }));
    await waitFor(() => expect(screen.queryByRole("button", { name: /Start Audio/i })).toBeNull());

    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]); // synth row
    expect(screen.getByText("SYNTH editor")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Test/ })); // audition middle C on synth
    expect(engine.callsTo("liveNoteOn").map((c) => c.args)).toContainEqual([0, 60, 110]);

    fireEvent.click(screen.getByRole("button", { name: /Back/ }));
    expect(screen.queryByText("SYNTH editor")).toBeNull();
    expect(screen.getByRole("button", { name: "PANIC" })).toBeInTheDocument();
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

  it("flushes a pending change on pagehide before the 300ms debounce (P4)", async () => {
    render(<App createEngine={() => engine} />);
    await screen.findByRole("option", { name: "Test Controller" });

    // Change BPM → schedules a debounced save that has NOT fired yet.
    fireEvent.change(screen.getByLabelText(/Tempo in BPM/i), { target: { value: "176" } });
    // Navigate away (refresh/close) immediately.
    fireEvent(window, new Event("pagehide"));

    const raw = localStorage.getItem("mpumpit.settings.v1");
    expect(raw && JSON.parse(raw).soundState.bpm).toBe(176);
  });

  it("flushes a pending change on unmount before the debounce (P4)", async () => {
    const { unmount } = render(<App createEngine={() => engine} />);
    await screen.findByRole("option", { name: "Test Controller" });

    fireEvent.change(screen.getByLabelText(/Tempo in BPM/i), { target: { value: "168" } });
    unmount(); // effect cleanup must flush before clearing the timer

    const raw = localStorage.getItem("mpumpit.settings.v1");
    expect(raw && JSON.parse(raw).soundState.bpm).toBe(168);
  });

  it("a reset wipe is not undone by a trailing pagehide flush (P4)", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    // Replace window.location for this test so resetSettings' reload() doesn't hit
    // jsdom's unimplemented navigation. App only calls location.reload().
    const realLocation = window.location;
    const reload = vi.fn();
    Object.defineProperty(window, "location", { configurable: true, value: { ...realLocation, href: realLocation.href, reload } });
    try {
      render(<App createEngine={() => engine} />);
      await screen.findByRole("option", { name: "Test Controller" });

      // Make a pending change, then reset all settings.
      fireEvent.change(screen.getByLabelText(/Tempo in BPM/i), { target: { value: "140" } });
      fireEvent.click(screen.getByRole("button", { name: "Settings and help" }));
      fireEvent.click(screen.getByRole("button", { name: "Reset all settings" }));
      expect(localStorage.getItem("mpumpit.settings.v1")).toBeNull(); // wiped

      expect(reload).toHaveBeenCalled();
      // The reload fires pagehide/unmount — a trailing flush must NOT resurrect it.
      fireEvent(window, new Event("pagehide"));
      expect(localStorage.getItem("mpumpit.settings.v1")).toBeNull();
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: realLocation });
      confirmSpy.mockRestore();
    }
  });
});
