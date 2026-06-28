// mpumpit — main application. Wires the SoundModule, the MIDI router, and
// persistence to a single instrument faceplate. Original work — AGPL-3.0-only.

import { useEffect, useReducer, useRef, useState } from "react";
import { SoundModule, type EngineFactory, type SoundStatus } from "../sound/SoundModule";
import { MidiRouter, ALL_INPUTS, type MidiInputInfo, type MidiPermissionState } from "../midi/router";
import { QwertyKeyboard } from "../midi/qwerty";
import { PARTS, type Part } from "../midi/types";
import type { FxTarget } from "../sound/types";
import { loadSettings, saveSettings, clearSettings } from "../state/persistence";
import { Led, Slider, Select } from "./components/Controls";
import { FxPanel } from "./components/FxPanel";
import { SettingsPanel } from "./components/SettingsPanel";

const PART_LABEL: Record<Part, string> = { synth: "SYNTH", bass: "BASS", drums: "DRUMS" };

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
// Scientific pitch notation (MIDI 60 = C4, A440 = A4).
const noteName = (n: number) => `${NOTE_NAMES[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 1}`;

export interface AppProps {
  /** Test seam: override the audio engine. Defaults to a real AudioPort. */
  createEngine?: EngineFactory;
}

export function App({ createEngine }: AppProps = {}) {
  const smRef = useRef<SoundModule | null>(null);
  const routerRef = useRef<MidiRouter | null>(null);
  const qwertyRef = useRef<QwertyKeyboard | null>(null);
  const qwertyTargetRef = useRef<Part>("synth");
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashTimers = useRef<Partial<Record<Part, ReturnType<typeof setTimeout>>>>({});

  const [, bump] = useReducer((x) => x + 1, 0);
  const [status, setStatus] = useState<SoundStatus>("idle");
  const [audioError, setAudioError] = useState<string | null>(null);
  const [permission, setPermission] = useState<MidiPermissionState>("idle");
  const [inputs, setInputs] = useState<MidiInputInfo[]>([]);
  const [selectedInput, setSelectedInput] = useState<string>(ALL_INPUTS);
  const [activity, setActivity] = useState<Record<Part, boolean>>({ synth: false, bass: false, drums: false });
  const [midiBlink, setMidiBlink] = useState(false);
  const [openFx, setOpenFx] = useState<FxTarget | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [qwertyOn, setQwertyOn] = useState(false);
  const [qwertyTarget, setQwertyTarget] = useState<Part>("synth");

  // ── one-time setup ──────────────────────────────────────────────────────────
  useEffect(() => {
    const settings = loadSettings();
    const sm = new SoundModule({ initialState: settings?.soundState, createEngine });
    const schedulePersist = () => {
      if (persistTimer.current) clearTimeout(persistTimer.current);
      persistTimer.current = setTimeout(() => {
        const r = routerRef.current;
        if (!r) return;
        saveSettings({ soundState: sm.getState(), channels: r.getChannels(), selectedInputId: r.getSelectedInputId() });
      }, 300);
    };
    const flash = (part: Part) => {
      setActivity((a) => (a[part] ? a : { ...a, [part]: true }));
      setMidiBlink(true);
      const t = flashTimers.current[part];
      if (t) clearTimeout(t);
      flashTimers.current[part] = setTimeout(() => {
        setActivity((a) => ({ ...a, [part]: false }));
        setMidiBlink(false);
      }, 140);
    };
    const router = new MidiRouter({
      sink: sm,
      channels: settings?.channels,
      drumMap: sm.getState().drumMap,
      selectedInputId: settings?.selectedInputId,
      onStateChange: () => {
        setPermission(router.getPermission());
        setInputs(router.listInputs());
        setSelectedInput(router.getSelectedInputId());
        schedulePersist();
      },
      onActivity: flash,
    });
    smRef.current = sm;
    routerRef.current = router;
    setSelectedInput(router.getSelectedInputId());

    // Computer-keyboard input. Feeds the router as a synthetic MIDI input on the
    // target part's current channel, so ownership/panic/activity all apply.
    const qwerty = new QwertyKeyboard({
      onNoteOn: (note, vel) => {
        const r = routerRef.current;
        if (!r) return;
        const ch = r.getChannels()[qwertyTargetRef.current];
        r.handleMessage("qwerty-keyboard", [0x90 | (ch - 1), note, vel]);
      },
      onNoteOff: (note) => {
        const r = routerRef.current;
        if (!r) return;
        const ch = r.getChannels()[qwertyTargetRef.current];
        r.handleMessage("qwerty-keyboard", [0x80 | (ch - 1), note, 0]);
      },
      onChange: () => bump(),
    });
    qwertyRef.current = qwerty;

    const unsub = sm.subscribe(() => { bump(); schedulePersist(); });
    void router.enable().then((perm) => {
      setPermission(perm);
      setInputs(router.listInputs());
    });

    // Only genuine free-text entry should swallow note keys. Number inputs and
    // <select> menus are NOT text entry, so when the keyboard is on its keys
    // take over from them — no overlapping shortcuts. Modifier combos (copy,
    // paste, browser shortcuts) and real text fields still pass through.
    const isTextEntry = () => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return false;
      if (el.isContentEditable || el.tagName === "TEXTAREA") return true;
      if (el.tagName === "INPUT") {
        const t = (el as HTMLInputElement).type;
        return ["text", "search", "email", "url", "tel", "password"].includes(t);
      }
      return false;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") { qwerty.releaseAll(); router.panic(); return; }
      if (e.ctrlKey || e.metaKey || e.altKey || isTextEntry()) return;
      if (qwerty.handleKeyDown(e.key, e.repeat)) e.preventDefault();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (qwerty.handleKeyUp(e.key)) e.preventDefault();
    };
    const onHide = () => { qwerty.releaseAll(); router.panic(); };
    const onVisibility = () => { if (document.hidden) { qwerty.releaseAll(); router.panic(); } };
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      if (persistTimer.current) clearTimeout(persistTimer.current);
      qwerty.releaseAll();
      unsub();
      router.dispose();
      sm.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sm = smRef.current;
  const router = routerRef.current;
  const st = sm?.getState();

  // ── handlers ──────────────────────────────────────────────────────────────
  const startAudio = async () => {
    if (!sm) return;
    setStatus("initializing");
    setAudioError(null);
    try {
      await sm.initialize();
      setStatus("ready");
    } catch (e) {
      setStatus("idle");
      setAudioError(e instanceof Error ? e.message : String(e));
    }
  };

  const channels = router?.getChannels() ?? { synth: 1, bass: 2, drums: 10 };
  const setChannel = (part: Part, ch: number) => {
    if (!router || Number.isNaN(ch)) return;
    router.setChannels({ [part]: Math.max(1, Math.min(16, ch)) });
    bump();
  };
  const setPreset = (part: Part, name: string) => {
    router?.releasePart(part); // avoid hung notes across the change
    sm?.setPreset(part, name);
  };
  const toggleFx = (target: FxTarget) => setOpenFx((cur) => (cur === target ? null : target));
  const toggleQwerty = (on: boolean) => { setQwertyOn(on); qwertyRef.current?.setEnabled(on); };
  const changeQwertyTarget = (part: Part) => {
    qwertyRef.current?.releaseAll(); // notes were on the old part's channel
    qwertyTargetRef.current = part;
    qwertyRef.current?.setDrumMode(part === "drums"); // keys become drum pads
    setQwertyTarget(part);
  };
  const panic = (hard: boolean) => { qwertyRef.current?.releaseAll(); if (hard) { router?.releaseAll(); sm?.panic(true); } else { router?.panic(); } };

  const onDrumMapChange = (overrides: Record<number, number>) => {
    sm?.setDrumMap(overrides);
    router?.setDrumMap(overrides);
    bump();
  };
  const resetSettings = () => {
    clearSettings();
    location.reload();
  };

  const hasActiveInput = !!router?.hasActiveInput();
  const midiLed: "idle" | "on" | "active" | "error" =
    permission === "unsupported" || permission === "denied" ? "error"
      : midiBlink ? "active" : hasActiveInput ? "on" : "idle";

  // ── render ──────────────────────────────────────────────────────────────────
  return (
    <div className="face">
      <div className="face-top">
        <div className="brand">
          <span className="brand-name">mpumpit</span>
          <span className="brand-sub">MIDI sound module · v{__APP_VERSION__}</span>
        </div>
        <div className="bpm">
          <span className="ctl-label">BPM</span>
          <input
            type="number" min={20} max={300} value={st?.bpm ?? 120}
            onChange={(e) => sm?.setBpm(Number(e.target.value))}
            aria-label="Tempo in BPM (for tempo-synced FX)"
          />
        </div>
        <button type="button" className="help-btn" aria-label="Settings and help"
          onClick={() => setShowSettings(true)}>?</button>
      </div>

      <MidiBay
        led={midiLed}
        permission={permission}
        inputs={inputs}
        selected={selectedInput}
        onSelect={(id) => router?.setSelectedInput(id)}
        onRetry={() => void router?.enable().then((p) => { setPermission(p); setInputs(router.listInputs()); })}
      />

      <div className="kbd-bar">
        <button type="button" className={`ctl-toggle${qwertyOn ? " is-on" : ""}`} aria-pressed={qwertyOn}
          onClick={() => toggleQwerty(!qwertyOn)} title="Play with your computer keyboard (Ableton layout)">
          ⌨ Keys
        </button>
        {qwertyOn && (
          <>
            <span className="ctl-label">plays</span>
            <Select value={qwertyTarget} options={PARTS as readonly string[]}
              onChange={(p) => changeQwertyTarget(p as Part)} title="Keyboard target part"
              ariaLabel="Keyboard target part" />
            <span className="kbd-info">
              {qwertyTarget === "drums"
                ? `Pads · Vel ${qwertyRef.current?.getVelocity() ?? 100}`
                : `Root ${noteName(qwertyRef.current?.getRootNote() ?? 48)} · Vel ${qwertyRef.current?.getVelocity() ?? 100}`}
            </span>
            <span className="kbd-hint">
              {qwertyTarget === "drums"
                ? "A kick · S rim · D snare · F/G hats · H–; perc · C/V vel"
                : "A–; notes · Z/X octave · C/V velocity"}
            </span>
          </>
        )}
      </div>

      {status === "ready" && sm?.isDegraded() && (
        <div className="warn-bar" role="alert">{sm.getWarning()}</div>
      )}

      {status !== "ready" && (
        <div className={`start-bar${audioError ? " has-error" : ""}`}>
          <button type="button" className="start-btn" onClick={startAudio} disabled={status === "initializing"}>
            {status === "initializing" ? "Starting…" : "▶ Start Audio"}
          </button>
          <span className="start-msg">
            {audioError
              ? `Audio failed: ${audioError}`
              : "Browsers require a click before sound can play. Incoming MIDI is queued until you start."}
          </span>
        </div>
      )}

      <div className="rows">
        {PARTS.map((part) => (
          <div key={part}>
            <div className="row">
              <span className="row-name">{PART_LABEL[part]}</span>
              <Led state={activity[part] ? "active" : status === "ready" ? "on" : "idle"} title={`${part} activity`} />
              <label className="row-ch">
                <span className="ctl-label">CH</span>
                <input type="number" min={1} max={16} value={channels[part]}
                  aria-label={`Incoming MIDI channel for ${PART_LABEL[part]}`}
                  onChange={(e) => setChannel(part, Number(e.target.value))} />
              </label>
              <Select
                value={st?.parts[part].preset ?? "Default"}
                options={sm?.getPresetNames(part) ?? []}
                onChange={(name) => setPreset(part, name)}
                title={part === "drums" ? "Drum kit" : "Preset"}
              />
              <Slider label="Vol" min={0} max={1} step={0.01}
                value={st?.parts[part].volume ?? 0.8}
                onChange={(v) => sm?.setPartVolume(part, v)}
                format={(v) => `${Math.round(v * 100)}`} />
              <button type="button" className={`fx-btn${openFx === part ? " is-open" : ""}`}
                aria-expanded={openFx === part} onClick={() => toggleFx(part)}>FX</button>
            </div>
            {openFx === part && sm && <FxPanel sm={sm} target={part} onChange={bump} />}
          </div>
        ))}
      </div>

      <div className="row row-master">
        <span className="row-name">MASTER</span>
        <span className="row-spacer" />
        <Slider label="Vol" min={0} max={1} step={0.01}
          value={st?.masterVolume ?? 0.85}
          onChange={(v) => sm?.setMasterVolume(v)}
          format={(v) => `${Math.round(v * 100)}`} />
        <button type="button" className={`fx-btn${openFx === "master" ? " is-open" : ""}`}
          aria-expanded={openFx === "master"} onClick={() => toggleFx("master")}>FX</button>
        <button type="button" className="panic"
          title="Click: all notes off · Double-click: hard mute (cut FX tails)"
          onClick={() => panic(false)}
          onDoubleClick={() => panic(true)}>
          PANIC
        </button>
      </div>
      {openFx === "master" && sm && <FxPanel sm={sm} target="master" onChange={bump} />}

      {showSettings && sm && (
        <SettingsPanel sm={sm} onDrumMapChange={onDrumMapChange} onReset={resetSettings}
          onClose={() => setShowSettings(false)} />
      )}
    </div>
  );
}

function MidiBay(props: {
  led: "idle" | "on" | "active" | "error";
  permission: MidiPermissionState;
  inputs: MidiInputInfo[];
  selected: string;
  onSelect: (id: string) => void;
  onRetry: () => void;
}) {
  const { led, permission, inputs, selected, onSelect, onRetry } = props;
  const connected = inputs.filter((i) => i.connected);

  let body: React.ReactNode;
  if (permission === "unsupported") {
    body = <span className="bay-msg bay-err">Web MIDI needs Chrome or Edge over HTTPS or localhost.</span>;
  } else if (permission === "denied") {
    body = (
      <span className="bay-msg bay-err">
        MIDI permission denied. <button type="button" className="link" onClick={onRetry}>Try again</button>
      </span>
    );
  } else if (permission === "granted" && connected.length === 0) {
    body = <span className="bay-msg">No MIDI inputs. Open IAC / loopMIDI / ALSA, or plug in a controller.</span>;
  } else if (permission === "granted") {
    const options = [ALL_INPUTS, ...connected.map((i) => i.id)];
    // If a saved selection isn't currently connected, surface it honestly as a
    // disconnected option rather than silently showing "All MIDI inputs" while
    // the router is actually attached to nothing (it reattaches on hot-plug).
    const missingSelected = selected !== ALL_INPUTS && !options.includes(selected);
    if (missingSelected) options.push(selected);
    const labelFor = (id: string) => {
      if (id === ALL_INPUTS) return "All MIDI inputs";
      const found = connected.find((i) => i.id === id);
      if (found) return found.name;
      return id === selected ? "Saved device (disconnected)" : id;
    };
    return (
      <div className="bay">
        <span className="ctl-label">MIDI IN</span>
        <Led state={led} title={led === "active" ? "MIDI activity" : connected.length ? "connected" : "idle"} />
        <select className="bay-select" value={selected} onChange={(e) => onSelect(e.target.value)} aria-label="MIDI input">
          {options.map((id) => <option key={id} value={id}>{labelFor(id)}</option>)}
        </select>
      </div>
    );
  } else {
    body = <span className="bay-msg">Requesting MIDI access…</span>;
  }

  return (
    <div className="bay">
      <span className="ctl-label">MIDI IN</span>
      <Led state={led} title="MIDI status" />
      {body}
    </div>
  );
}
