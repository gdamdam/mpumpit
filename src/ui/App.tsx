// mpumpit — main application. Wires the SoundModule, the MIDI router, and
// persistence to a single instrument faceplate. Original work — AGPL-3.0-only.

import { useEffect, useReducer, useRef, useState } from "react";
import { SoundModule, type EngineFactory, type SoundStatus } from "../sound/SoundModule";
import { MidiRouter, ALL_INPUTS, type MidiInputInfo, type MidiPermissionState } from "../midi/router";
import { PARTS, type Part } from "../midi/types";
import type { FxTarget } from "../sound/types";
import { loadSettings, saveSettings, clearSettings } from "../state/persistence";
import { Led, Slider, Select } from "./components/Controls";
import { FxPanel } from "./components/FxPanel";
import { SettingsPanel } from "./components/SettingsPanel";

const PART_LABEL: Record<Part, string> = { synth: "SYNTH", bass: "BASS", drums: "DRUMS" };

export interface AppProps {
  /** Test seam: override the audio engine. Defaults to a real AudioPort. */
  createEngine?: EngineFactory;
}

export function App({ createEngine }: AppProps = {}) {
  const smRef = useRef<SoundModule | null>(null);
  const routerRef = useRef<MidiRouter | null>(null);
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

    const unsub = sm.subscribe(() => { bump(); schedulePersist(); });
    void router.enable().then((perm) => {
      setPermission(perm);
      setInputs(router.listInputs());
    });

    const onHide = () => router.panic();
    const onVisibility = () => { if (document.hidden) router.panic(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") router.panic(); };
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("keydown", onKey);

    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("keydown", onKey);
      if (persistTimer.current) clearTimeout(persistTimer.current);
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
          <span className="brand-sub">MIDI sound module</span>
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
          onClick={() => router?.panic()}
          onDoubleClick={() => { router?.releaseAll(); sm?.panic(true); }}>
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
    const labelFor = (id: string) => (id === ALL_INPUTS ? "All MIDI inputs" : connected.find((i) => i.id === id)?.name ?? id);
    const value = options.includes(selected) ? selected : ALL_INPUTS;
    return (
      <div className="bay">
        <span className="ctl-label">MIDI IN</span>
        <Led state={led} title={led === "active" ? "MIDI activity" : connected.length ? "connected" : "idle"} />
        <select className="bay-select" value={value} onChange={(e) => onSelect(e.target.value)} aria-label="MIDI input">
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
