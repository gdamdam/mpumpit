// Full-screen sound editor: header (preset select, Save as / Delete / Reset,
// modified marker, test) over the synth or drum editor. Original work — AGPL-3.0.

import type { SoundModule } from "../../sound/SoundModule";
import type { Part } from "../../midi/types";
import { SynthEditor } from "../components/SynthEditor";
import { DrumEditor } from "../components/DrumEditor";
import { Dropdown, type DropdownGroup } from "../components/Dropdown";

export function EditorView(props: {
  sm: SoundModule;
  part: Part;
  onBack: () => void;
  onChange: () => void;
  onTest: (note: number) => void;
}) {
  const { sm, part, onBack, onChange, onTest } = props;
  const preset = sm.getState().parts[part].preset;
  const userNames = sm.getUserPresetNames(part);
  const builtinNames = sm.getPresetNames(part).filter((n) => !userNames.includes(n));
  const modified = sm.isPartModified(part);
  const isUser = sm.isUserPreset(part, preset);

  const selectPreset = (name: string) => { sm.setPreset(part, name); onChange(); };
  const saveAs = () => {
    const name = window.prompt("Save preset as:", isUser ? preset : `${preset} *`);
    if (name && name.trim()) { sm.saveUserPreset(part, name); onChange(); }
  };
  const del = () => {
    if (window.confirm(`Delete user preset "${preset}"?`)) { sm.deleteUserPreset(part, preset); onChange(); }
  };
  const reset = () => { sm.setPreset(part, preset); onChange(); }; // reload preset values

  return (
    <div className="editor-view">
      <header className="editor-head">
        <button type="button" className="editor-back" onClick={onBack}>← Back</button>
        <span className="editor-title">{part.toUpperCase()} editor</span>
        <span className="editor-spacer" />
        <span className="editor-preset" title="Preset">
          <Dropdown
            value={preset}
            groups={[
              { label: "Presets", options: builtinNames.map((n) => ({ value: n, label: n })) },
              ...(userNames.length > 0
                ? [{ label: "User", options: userNames.map((n) => ({ value: n, label: n })) }]
                : []),
            ] as DropdownGroup[]}
            onChange={selectPreset}
            ariaLabel={`${part} preset`}
          />
        </span>
        {modified && <span className="editor-mod" title="Edited since the preset was loaded">✎</span>}
        <button type="button" className="editor-btn" onClick={saveAs}>Save as…</button>
        {isUser && <button type="button" className="editor-btn" onClick={del}>Delete</button>}
        <button type="button" className="editor-btn" onClick={reset} title="Reload the preset's values (discard edits)">Reset</button>
        {part !== "drums" && <button type="button" className="editor-btn editor-test" onClick={() => onTest(60)}>▶ Test</button>}
      </header>

      {part === "drums"
        ? <DrumEditor sm={sm} onChange={onChange} onTest={onTest} />
        : <SynthEditor sm={sm} part={part} onChange={onChange} />}
    </div>
  );
}
