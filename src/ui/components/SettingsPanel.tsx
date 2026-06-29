// Settings / help panel: how to connect midip, the drum compatibility map
// (editable), and a reset. Original work — AGPL-3.0-only.

import type { SoundModule } from "../../sound/SoundModule";
import { MIDIP_DRUM_LANES, MPUMP_DRUM_VOICE_LABELS, MPUMP_PLAYABLE_DRUM_NOTES } from "../../sound/drumMap";

export function SettingsPanel(props: {
  sm: SoundModule;
  onDrumMapChange: (overrides: Record<number, number>) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const { sm, onDrumMapChange, onReset, onClose } = props;
  const map = sm.getDrumMap();
  const lanes = Object.keys(MIDIP_DRUM_LANES).map(Number).sort((a, b) => a - b);

  const setTarget = (lane: number, target: number) => {
    const next = { ...map };
    if (target === lane) delete next[lane];
    else next[lane] = target;
    onDrumMapChange(next);
  };

  return (
    <div className="settings" role="dialog" aria-label="Settings and help">
      <header className="settings-head">
        <h2>Settings &amp; help</h2>
        <button type="button" className="settings-close" onClick={onClose} aria-label="Close">✕</button>
      </header>

      <section className="settings-block">
        <h3>Connect midip (or any same-computer app)</h3>
        <p>A program on the same machine reaches the browser through a virtual MIDI port:</p>
        <ul>
          <li><b>macOS</b> — open <i>Audio MIDI Setup → MIDI Studio</i>, double-click <i>IAC Driver</i>, tick <i>Device is online</i>. Point midip at the IAC bus; select it here.</li>
          <li><b>Windows</b> — install <i>loopMIDI</i>, create a port, send midip to it, select it here.</li>
          <li><b>Linux</b> — use an ALSA virtual MIDI (e.g. <code>snd-virmidi</code>) or connect with <code>aconnect</code>.</li>
        </ul>
        <p>A physical USB MIDI controller can be selected directly — no virtual port needed.</p>
      </section>

      <section className="settings-block">
        <h3>Default channels</h3>
        <p>Synth = 1, Bass = 2, Drums = 10. Editable per part on the main panel.</p>
      </section>

      <section className="settings-block">
        <h3>Computer keyboard</h3>
        <p>
          Click <b>⌨ Keys</b> to play without MIDI gear (Ableton layout: A = C3, W/E/T/Y/U/O/P black
          keys, Z/X octave, C/V velocity). Choose which part it plays. For drums the white row is a
          pad layout (A = kick, S = rim, …). <b>Direct</b> plays the part directly; <b>Over MIDI</b>
          layers it through channel routing + the drum-map, like an external controller.
        </p>
      </section>

      <section className="settings-block">
        <h3>Editing sounds</h3>
        <p>
          Each part's <b>Edit</b> button opens a full editor for its sound — every synth/drum
          parameter, with live ADSR, filter and LFO views. Presets are the starting point; edits are
          a live override that persists (a <b>✎</b> marks an edited part). <b>Save as…</b> stores named
          user presets; <b>Reset</b> reloads the preset; selecting a preset discards edits.
        </p>
      </section>

      <section className="settings-block">
        <h3>Drum map · midip → mpump</h3>
        <p>
          midip and mpump both use GM-ish drum notes, but the voices differ. Every midip lane is
          audible; midip's tom lanes (47, 50) play mpump's cowbell/clap because mpump has no toms.
          Override any lane's target note below.
        </p>
        <table className="drum-map">
          <thead><tr><th>midip lane</th><th>→ note</th><th>plays in mpump</th></tr></thead>
          <tbody>
            {lanes.map((lane) => {
              const target = map[lane] ?? lane;
              const playable = MPUMP_PLAYABLE_DRUM_NOTES.has(target);
              return (
                <tr key={lane}>
                  <td>{lane} · {MIDIP_DRUM_LANES[lane]}</td>
                  <td>
                    <input type="number" min={0} max={127} value={target}
                      onChange={(e) => setTarget(lane, Number(e.target.value))} />
                  </td>
                  <td className={playable ? "" : "drum-silent"}>
                    {playable ? MPUMP_DRUM_VOICE_LABELS[target] : "— no voice (silent)"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="settings-block">
        <h3>Reset</h3>
        <p>Clear saved input, channels, presets, volumes and FX, and restore defaults.</p>
        <button type="button" className="settings-reset" onClick={onReset}>Reset all settings</button>
      </section>

      <footer className="settings-foot">
        mpumpit drives mpump's AGPL-3.0 audio engine. Web MIDI needs Chrome or Edge over HTTPS or localhost.
      </footer>
    </div>
  );
}
