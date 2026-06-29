// FX editor: a reorderable MASTER effect chain (mpump's real model) and a
// fixed per-part channel strip. Progressive disclosure keeps it performable.
// Original work — AGPL-3.0-only.

import { useState } from "react";
import type { SoundModule } from "../../sound/SoundModule";
import type { FxTarget, FxChainItem } from "../../sound/types";
import { type EffectName, DEFAULT_EFFECTS } from "../../engine/types";
import type { Part } from "../../midi/types";
import { FX_META, WET_LABEL } from "../fxMeta";
import { Slider, Select, Toggle } from "./Controls";

const GATE_RATES = ["1/4", "1/8", "1/16", "1/32"];
const GATE_SHAPES = ["sine", "square"];

export function FxPanel(props: { sm: SoundModule; target: FxTarget; onChange: () => void }) {
  if (props.target === "master") return <MasterFx {...props} />;
  return <PartStrip sm={props.sm} part={props.target} onChange={props.onChange} />;
}

// ── Master chain ─────────────────────────────────────────────────────────────

function MasterFx({ sm, onChange }: { sm: SoundModule; target: FxTarget; onChange: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const chain = sm.getEffectChain("master");

  const move = (index: number, dir: -1 | 1) => {
    const items = chain.items;
    const target = index + dir;
    if (target < 0 || target >= items.length) return;
    if (!items[index].reorderable || !items[target].reorderable) return;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    sm.setMasterEffectChain(next);
    onChange();
  };

  return (
    <div className="fx">
      <div className="fx-hint">Master FX chain · signal flows top → bottom</div>
      {chain.items.map((item, i) => (
        <FxRow
          key={item.id}
          item={item}
          index={i}
          expanded={open === item.id}
          onToggleOpen={() => setOpen(open === item.id ? null : item.id)}
          onEnable={(on) => { sm.setEffectEnabled("master", item.id, on); onChange(); }}
          onParam={(p, v) => { sm.setEffectParameter("master", item.id, p, v); onChange(); }}
          onReset={() => { sm.resetEffect("master", item.id); onChange(); }}
          onMove={item.reorderable ? (dir) => move(i, dir) : undefined}
        />
      ))}
      <button type="button" className="fx-reset-all" onClick={() => { sm.resetAllEffects(); onChange(); }}>
        Reset all FX
      </button>
    </div>
  );
}

function FxRow(props: {
  item: FxChainItem;
  index: number;
  expanded: boolean;
  onToggleOpen: () => void;
  onEnable: (on: boolean) => void;
  onParam: (param: string, value: unknown) => void;
  onReset: () => void;
  onMove?: (dir: -1 | 1) => void;
}) {
  const { item, expanded } = props;
  const meta = FX_META[item.id as EffectName];
  const p = item.params as Record<string, unknown>;
  // Truthful display fallback: the effect's real default, then the meta default,
  // then the slider minimum — never a hardcoded guess that diverges from the engine.
  const def = DEFAULT_EFFECTS[item.id as EffectName] as Record<string, unknown> | undefined;

  return (
    <div className={`fx-row${item.enabled ? " is-on" : ""}`}>
      <div className="fx-row-head">
        <Toggle label={meta.label} on={item.enabled} onChange={props.onEnable}
          title={`${meta.full} — ${item.enabled ? "on" : "bypassed"}`} />
        <span className="fx-row-name">{meta.full}</span>
        {meta.tempo && <span className="fx-badge" title="Tempo-synced (uses global BPM)">SYNC</span>}
        <span className="fx-row-spacer" />
        {props.onMove && (
          <span className="fx-move">
            <button type="button" onClick={() => props.onMove!(-1)} aria-label="Move up" title="Move earlier">▲</button>
            <button type="button" onClick={() => props.onMove!(1)} aria-label="Move down" title="Move later">▼</button>
          </span>
        )}
        <button type="button" className="fx-expand" aria-expanded={expanded} onClick={props.onToggleOpen}>
          {expanded ? "Hide" : "Edit"}
        </button>
      </div>
      {expanded && (
        <div className="fx-row-body">
          {meta.toggles?.map((t) => (
            <Toggle key={t.key} label={t.label} on={!!p[t.key]} onChange={(on) => props.onParam(t.key, on)} />
          ))}
          {meta.selects?.map((s) => (
            <Select key={s.key} label={s.label} value={String(p[s.key] ?? s.options[0])}
              options={s.options} onChange={(v) => props.onParam(s.key, v)} />
          ))}
          {meta.params.map((pm) => (
            <Slider key={pm.key} label={pm.label} min={pm.min} max={pm.max} step={pm.step}
              value={Number(p[pm.key] ?? def?.[pm.key] ?? pm.def ?? pm.min)} onChange={(v) => props.onParam(pm.key, v)}
              format={(v) => fmt(v, pm.step)} />
          ))}
          {meta.wet && (
            <Slider label={WET_LABEL} min={0} max={1} step={0.01}
              value={Number(p[meta.wet] ?? def?.[meta.wet] ?? 0.3)} onChange={(v) => props.onParam(meta.wet!, v)}
              format={(v) => `${Math.round(v * 100)}%`} />
          )}
          <ExcludeToggles params={p} onParam={props.onParam} hasDrums={item.id !== "duck"} />
          <button type="button" className="fx-reset" onClick={props.onReset}>Reset</button>
        </div>
      )}
    </div>
  );
}

function ExcludeToggles(props: {
  params: Record<string, unknown>;
  onParam: (param: string, value: unknown) => void;
  hasDrums: boolean;
}) {
  const { params, onParam, hasDrums } = props;
  // mpump models per-part FX participation as exclusion flags on each master
  // effect — so "applies to" toggles are the honest per-part FX control.
  const row: Array<[string, Part]> = [
    ...(hasDrums ? ([["excludeDrums", "drums"]] as Array<[string, Part]>) : []),
    ["excludeBass", "bass"],
    ["excludeSynth", "synth"],
  ];
  return (
    <div className="fx-excl">
      <span className="ctl-label">Applies to</span>
      {row.map(([key, part]) => (
        <Toggle
          key={key}
          label={part}
          on={!params[key]} // toggle shows inclusion; excluded => off
          onChange={(included) => onParam(key, !included)}
          title={`${part} ${params[key] ? "excluded from" : "sent through"} this effect`}
        />
      ))}
    </div>
  );
}

// ── Per-part channel strip ───────────────────────────────────────────────────

function PartStrip({ sm, part, onChange }: { sm: SoundModule; part: Part; onChange: () => void }) {
  const chain = sm.getEffectChain(part);
  const byId = Object.fromEntries(chain.items.map((i) => [i.id, i]));
  const set = (id: string, param: string, v: unknown) => { sm.setEffectParameter(part, id, param, v); onChange(); };
  const enable = (id: string, on: boolean) => { sm.setEffectEnabled(part, id, on); onChange(); };
  const reset = (id: string) => { sm.resetEffect(part, id); onChange(); };

  return (
    <div className="fx">
      <div className="fx-hint">Channel strip · fixed processing (not reorderable)</div>

      {byId.eq && (
        <div className="strip-group">
          <div className="strip-group-head"><span>EQ</span>
            <button type="button" className="fx-reset" onClick={() => reset("eq")}>Reset</button></div>
          {(() => {
            const eq = byId.eq.params as { low: number; mid: number; high: number };
            return (<>
              <Slider label="Low" min={-12} max={12} step={0.5} value={eq.low} onChange={(v) => set("eq", "low", v)} format={dB} />
              <Slider label="Mid" min={-12} max={12} step={0.5} value={eq.mid} onChange={(v) => set("eq", "mid", v)} format={dB} />
              <Slider label="High" min={-12} max={12} step={0.5} value={eq.high} onChange={(v) => set("eq", "high", v)} format={dB} />
            </>);
          })()}
        </div>
      )}

      {byId.hpf && (
        <div className="strip-group">
          <div className="strip-group-head">
            <Toggle label="HPF" on={byId.hpf.enabled} onChange={(on) => enable("hpf", on)} />
            <button type="button" className="fx-reset" onClick={() => reset("hpf")}>Reset</button>
          </div>
          <Slider label="Cutoff" min={20} max={500} step={1} value={Number(byId.hpf.params.freq ?? 120)}
            onChange={(v) => set("hpf", "freq", v)} format={(v) => `${Math.round(v)}Hz`} />
        </div>
      )}

      {byId.pan && (
        <div className="strip-group">
          <div className="strip-group-head"><span>Pan</span>
            <button type="button" className="fx-reset" onClick={() => reset("pan")}>Reset</button></div>
          <Slider label="Pan" min={-1} max={1} step={0.05} value={(byId.pan.params as { pan: number }).pan}
            onChange={(v) => set("pan", "pan", v)} format={panFmt} />
        </div>
      )}

      {byId.gate && (() => {
        const gp = byId.gate.params as { rate: string; depth: number; shape: string };
        return (
          <div className="strip-group">
            <div className="strip-group-head">
              <Toggle label="Gate" on={byId.gate.enabled} onChange={(on) => enable("gate", on)} />
              <button type="button" className="fx-reset" onClick={() => reset("gate")}>Reset</button>
            </div>
            <Select label="Rate" value={gp.rate} options={GATE_RATES} onChange={(v) => set("gate", "rate", v)} />
            <Select label="Shape" value={gp.shape} options={GATE_SHAPES} onChange={(v) => set("gate", "shape", v)} />
            <Slider label="Depth" min={0} max={1} step={0.01} value={gp.depth} onChange={(v) => set("gate", "depth", v)} format={(v) => `${Math.round(v * 100)}%`} />
          </div>
        );
      })()}

      {!byId.eq && (
        <div className="fx-note">
          Tone for {part}: use the preset filter and Master ▸ HPF (with its
          per-part “Applies to”). mpump's worklet voice has no per-channel EQ.
        </div>
      )}
    </div>
  );
}

// ── formatting ───────────────────────────────────────────────────────────────

function fmt(v: number, step: number): string {
  if (step >= 1) return String(Math.round(v));
  if (step >= 0.1) return v.toFixed(1);
  if (step >= 0.01) return v.toFixed(2);
  return v.toFixed(4);
}
function dB(v: number): string { return `${v > 0 ? "+" : ""}${v.toFixed(1)}dB`; }
function panFmt(v: number): string {
  if (Math.abs(v) < 0.025) return "C";
  return v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`;
}
