// Small reusable instrument controls. Original work — AGPL-3.0-only.
import { type ReactNode } from "react";

/** A labelled horizontal slider with a monospace readout. */
export function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  title?: string;
}) {
  const { label, value, min, max, step, onChange, format, title } = props;
  return (
    <label className="ctl-slider" title={title}>
      <span className="ctl-label">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="ctl-readout">{format ? format(value) : String(value)}</span>
    </label>
  );
}

/** A select bound to a list of string options. */
export function Select(props: {
  label?: string;
  value: string;
  options: readonly string[];
  onChange: (v: string) => void;
  title?: string;
  ariaLabel?: string;
}) {
  const { label, value, options, onChange, title, ariaLabel } = props;
  return (
    <label className="ctl-select" title={title}>
      {label && <span className="ctl-label">{label}</span>}
      <select value={value} aria-label={ariaLabel} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </label>
  );
}

/** A small on/off pill toggle. */
export function Toggle(props: {
  label: string;
  on: boolean;
  onChange: (on: boolean) => void;
  title?: string;
}) {
  const { label, on, onChange, title } = props;
  return (
    <button
      type="button"
      className={`ctl-toggle${on ? " is-on" : ""}`}
      aria-pressed={on}
      onClick={() => onChange(!on)}
      title={title}
    >
      {label}
    </button>
  );
}

/** An LED indicator: idle / connected / activity / error. */
export function Led(props: { state: "idle" | "on" | "active" | "error"; title?: string }) {
  return <span className={`led led-${props.state}`} role="img" aria-label={props.title} title={props.title} />;
}

/** A bordered panel section with a silkscreen header. */
export function Panel(props: { heading?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={`panel${props.className ? " " + props.className : ""}`}>
      {props.heading && <header className="panel-head">{props.heading}</header>}
      {props.children}
    </section>
  );
}
