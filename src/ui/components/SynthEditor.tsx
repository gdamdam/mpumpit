// Full-parity synth/bass editor: OSCILLATOR / FILTER / LFO sections with live
// ADSR, filter-response and LFO visualizations. Original work — AGPL-3.0-only.

import type { SoundModule } from "../../sound/SoundModule";
import type { SynthParams, OscType, FilterType, FilterModel, LfoShape } from "../../engine/types";
import { Knob } from "./Knob";
import { Select, Toggle } from "./Controls";
import { OscIcon, FilterModelIcon, AdsrCurve, FilterCurve, LfoCurve } from "./synthViz";
import {
  OSC_TYPE_SELECT, OSC_KNOBS, OSC_TOGGLES, ENV_KNOBS, OSC_TYPE_EXTRAS,
  FILTER_SELECTS, FILTER_TOGGLES, FILTER_KNOBS, LFO_SELECTS, LFO_TOGGLES, LFO_KNOBS,
  type SynthKnob, type SynthSelect, type SynthToggle,
} from "../synthParamMeta";

type SynthPart = "synth" | "bass";

function fmtFor(f?: SynthKnob["format"]): ((v: number) => string) | undefined {
  switch (f) {
    case "int": return (v) => String(Math.round(v));
    case "sec": return (v) => `${v.toFixed(2)}s`;
    case "hz": return (v) => `${Math.round(v)}Hz`;
    case "pct": return (v) => `${Math.round(v * 100)}%`;
    case "cents": return (v) => `${v > 0 ? "+" : ""}${Math.round(v)}`;
    default: return undefined;
  }
}

export function SynthEditor(props: { sm: SoundModule; part: SynthPart; onChange: () => void }) {
  const { sm, part, onChange } = props;
  const p = sm.getSynthParams(part);
  const set = (patch: Partial<SynthParams>) => { sm.setSynthParam(part, patch); onChange(); };

  const knob = (k: SynthKnob) => (
    <Knob key={k.key} label={k.label} min={k.min} max={k.max} step={k.step}
      value={Number((p[k.key] as number | undefined) ?? k.def)}
      onChange={(v) => set({ [k.key]: v } as Partial<SynthParams>)} format={fmtFor(k.format)} />
  );
  const select = (s: SynthSelect) => (
    <Select key={s.key} label={s.label} options={s.options} value={String(p[s.key] ?? s.options[0])}
      onChange={(v) => set({ [s.key]: v } as Partial<SynthParams>)} />
  );
  const toggle = (t: SynthToggle) => (
    <Toggle key={t.key} label={t.label} on={!!p[t.key]} onChange={(on) => set({ [t.key]: on } as Partial<SynthParams>)} />
  );

  const extras = OSC_TYPE_EXTRAS[p.oscType as OscType];

  return (
    <div className="synth-editor">
      <section className="ed-section">
        <header className="ed-section-h">
          <span className="ed-osc-icon"><OscIcon type={p.oscType as OscType} /></span>OSCILLATOR
        </header>
        <div className="ed-row">
          {select(OSC_TYPE_SELECT)}
          {extras?.selects?.map(select)}
          {OSC_TOGGLES.map(toggle)}
        </div>
        <div className="ed-knobs">
          {OSC_KNOBS.map(knob)}
          {extras?.knobs?.map(knob)}
        </div>
        <AdsrCurve attack={p.attack} decay={p.decay} sustain={p.sustain} release={p.release} />
        <div className="ed-knobs">{ENV_KNOBS.map(knob)}</div>
      </section>

      <section className="ed-section">
        <header className="ed-section-h">{FILTER_TOGGLES.map(toggle)} FILTER</header>
        <div className="ed-row">
          {FILTER_SELECTS.map(select)}
          <span className="ed-model-icon"><FilterModelIcon model={(p.filterModel ?? "digital") as FilterModel} /></span>
        </div>
        <FilterCurve cutoff={p.cutoff} resonance={p.resonance} filterType={p.filterType as FilterType} />
        <div className="ed-knobs">{FILTER_KNOBS.map(knob)}</div>
      </section>

      <section className="ed-section">
        <header className="ed-section-h">{LFO_TOGGLES.filter((t) => t.key === "lfoOn").map(toggle)} LFO</header>
        <div className="ed-row">
          {LFO_SELECTS.filter((s) => s.key !== "lfoDivision").map(select)}
          {LFO_TOGGLES.filter((t) => t.key === "lfoSync").map(toggle)}
          {p.lfoSync
            ? LFO_SELECTS.filter((s) => s.key === "lfoDivision").map(select)
            : knob(LFO_KNOBS[0])}
        </div>
        <LfoCurve shape={p.lfoShape as LfoShape} depth={p.lfoDepth} />
        <div className="ed-knobs">{knob(LFO_KNOBS[1])}</div>
      </section>
    </div>
  );
}
