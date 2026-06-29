// Per-voice drum editor: pick a voice, edit its full parameters, audition it.
// Original work — AGPL-3.0-only.

import { useState } from "react";
import type { SoundModule } from "../../sound/SoundModule";
import type { DrumVoiceParams } from "../../engine/types";
import { Knob } from "./Knob";
import { DRUM_PARAMS, DRUM_VOICE_LIST } from "../drumParamMeta";

export function DrumEditor(props: { sm: SoundModule; onChange: () => void; onTest: (note: number) => void }) {
  const { sm, onChange, onTest } = props;
  const [note, setNote] = useState<number>(DRUM_VOICE_LIST[0].note);
  const voice = sm.getDrumVoice(note);
  const set = (patch: Partial<DrumVoiceParams>) => { sm.setDrumVoiceParam(note, patch); onChange(); };

  return (
    <div className="drum-editor">
      <div className="ed-voice-picker" role="tablist" aria-label="Drum voice">
        {DRUM_VOICE_LIST.map((v) => (
          <button key={v.note} type="button" role="tab" aria-selected={v.note === note}
            className={`ed-voice${v.note === note ? " is-sel" : ""}`} onClick={() => setNote(v.note)}>
            {v.name}
          </button>
        ))}
      </div>

      <div className="ed-row ed-voice-head">
        <span className="ed-voice-name">{DRUM_VOICE_LIST.find((v) => v.note === note)?.name} · note {note}</span>
        <button type="button" className="ed-test" onClick={() => onTest(note)}>▶ Test</button>
      </div>

      <div className="ed-knobs">
        {DRUM_PARAMS.map((k) => (
          <Knob key={k.key} label={k.label} min={k.min} max={k.max} step={k.step}
            value={Number((voice[k.key] as number | undefined) ?? k.min)}
            onChange={(v) => set({ [k.key]: v } as Partial<DrumVoiceParams>)} />
        ))}
      </div>
    </div>
  );
}
