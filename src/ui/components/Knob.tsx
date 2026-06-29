// A rotary-style control rendered as a styled range input. Ported from mpump's
// synth editor Knob; recolored via CSS (amber accent var, not a hardcoded color).
// Original work — AGPL-3.0-only.

function defaultFmt(v: number): string {
  return v < 1 ? v.toFixed(2) : String(Math.round(v));
}

/** A labelled rotary knob (styled range input) with a monospace readout. */
export function Knob(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  const { label, value, min, max, step, onChange, format } = props;
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <label className="knob">
      <span className="knob-label">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        aria-valuetext={format ? format(value) : defaultFmt(value)}
        style={{ "--knob-pct": `${pct}%` } as React.CSSProperties}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
      <span className="knob-value">{format ? format(value) : defaultFmt(value)}</span>
    </label>
  );
}
