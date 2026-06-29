// Static SVG visualizations for the synth editor: oscillator waveform icons,
// filter-model response icons, ADSR envelope, filter response, and LFO shape.
// Ported from mpump's SynthEditor SVG helpers; the green accent is replaced by a
// `color` prop (default "currentColor") so the parent sets the amber accent via CSS.
// Original work — AGPL-3.0-only.

import type { OscType, FilterType, FilterModel, LfoShape } from "../../engine/types";

/** Tiny inline SVG waveform icon for an oscillator type. */
export function OscIcon({ type, color = "currentColor" }: { type: OscType; color?: string }) {
  const w = 28, h = 12, m = 1;
  const mid = h / 2;
  const amp = mid - m;
  let d = "";
  switch (type) {
    case "sawtooth":
      d = `M${m},${mid} L${w / 2},${m} L${w / 2},${h - m} L${w - m},${m}`;
      break;
    case "square":
      d = `M${m},${h - m} L${m},${m} L${w / 2},${m} L${w / 2},${h - m} L${w - m},${h - m} L${w - m},${m}`;
      break;
    case "sine": {
      const pts = Array.from({ length: 20 }, (_, i) => {
        const x = m + (i / 19) * (w - 2 * m);
        const y = mid - Math.sin((i / 19) * Math.PI * 2) * amp;
        return `${x},${y}`;
      });
      d = `M${pts.join(" L")}`;
      break;
    }
    case "triangle":
      d = `M${m},${mid} L${w / 4},${m} L${w * 3 / 4},${h - m} L${w - m},${mid}`;
      break;
    case "pwm":
      d = `M${m},${h - m} L${m},${m} L${w * 0.3},${m} L${w * 0.3},${h - m} L${w - m},${h - m} L${w - m},${m}`;
      break;
    case "sync":
      d = `M${m},${mid} L${w * 0.3},${m} L${w * 0.3},${h - m} L${w * 0.5},${mid} L${w * 0.7},${m} L${w * 0.7},${h - m} L${w - m},${mid}`;
      break;
    case "fm": {
      const pts = Array.from({ length: 24 }, (_, i) => {
        const t = i / 23;
        const x = m + t * (w - 2 * m);
        const y = mid - Math.sin(t * Math.PI * 2 + Math.sin(t * Math.PI * 6) * 2) * amp * 0.8;
        return `${x},${y}`;
      });
      d = `M${pts.join(" L")}`;
      break;
    }
    case "wavetable": {
      const pts = Array.from({ length: 24 }, (_, i) => {
        const t = i / 23;
        const x = m + t * (w - 2 * m);
        const y = mid - (Math.sin(t * Math.PI * 2) * 0.6 + Math.sin(t * Math.PI * 6) * 0.4) * amp;
        return `${x},${y}`;
      });
      d = `M${pts.join(" L")}`;
      break;
    }
  }
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: "block", margin: "0 auto 1px" }}>
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** Tiny filter-response icon for a filter model. */
export function FilterModelIcon({ model, color = "currentColor" }: { model: FilterModel; color?: string }) {
  const w = 28, h = 12, m = 1;
  let d = "";
  switch (model) {
    case "digital": // sharp cutoff
      d = `M${m},${h * 0.3} L${w * 0.6},${h * 0.3} L${w * 0.7},${h * 0.25} L${w * 0.75},${h - m}`;
      break;
    case "mog": // warm rolloff with subtle resonance
      d = `M${m},${h * 0.3} L${w * 0.5},${h * 0.3} L${w * 0.6},${h * 0.2} L${w * 0.7},${h * 0.4} L${w - m},${h - m}`;
      break;
    case "303": // aggressive resonance peak
      d = `M${m},${h * 0.5} L${w * 0.4},${h * 0.5} L${w * 0.55},${m} L${w * 0.65},${h * 0.6} L${w * 0.75},${h - m}`;
      break;
  }
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: "block", margin: "0 auto 1px" }}>
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** Static SVG of the ADSR envelope shape. Standard fixed-segment layout. */
export function AdsrCurve({ attack, decay, sustain, release, color = "currentColor" }: {
  attack: number; decay: number; sustain: number; release: number; color?: string;
}) {
  const w = 200, h = 50, pad = 4;
  // Each segment gets a proportional share of 4 equal slots, clamped
  const segW = (w - pad * 2) / 4;
  const norm = (v: number, max: number) => Math.max(0.05, Math.min(1, v / max));
  const aW = norm(attack, 2) * segW;
  const dW = norm(decay, 2) * segW;
  const sW = segW; // sustain hold is always fixed width
  const rW = norm(release, 3) * segW;

  const x0 = pad;
  const x1 = x0 + aW;
  const x2 = x1 + dW;
  const x3 = x2 + sW;
  const x4 = x3 + rW;

  const yTop = pad;
  const yBot = h - pad;
  const ySus = yBot - sustain * (h - pad * 2);

  const path = `M ${x0},${yBot} L ${x1},${yTop} L ${x2},${ySus} L ${x3},${ySus} L ${x4},${yBot}`;

  return (
    <svg className="adsr-curve" viewBox={`0 0 ${w} ${h}`}>
      <path d={path} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
      <path d={`${path} L ${x0},${yBot}`} fill={color} fillOpacity="0.15" />
      {/* Phase markers */}
      <line x1={x1} y1={yTop} x2={x1} y2={yBot} stroke={color} strokeWidth="0.5" strokeDasharray="2,2" opacity="0.4" />
      <line x1={x2} y1={ySus} x2={x2} y2={yBot} stroke={color} strokeWidth="0.5" strokeDasharray="2,2" opacity="0.4" />
      <line x1={x3} y1={ySus} x2={x3} y2={yBot} stroke={color} strokeWidth="0.5" strokeDasharray="2,2" opacity="0.4" />
    </svg>
  );
}

/** Static SVG of the filter response curve. */
export function FilterCurve({ cutoff, resonance, filterType, color = "currentColor" }: {
  cutoff: number; resonance: number; filterType: FilterType; color?: string;
}) {
  const w = 120, h = 40, pad = 2;
  const cutX = pad + ((Math.log(cutoff) - Math.log(100)) / (Math.log(8000) - Math.log(100))) * (w - pad * 2);
  const resPeak = (resonance / 20) * 0.6;

  const points: string[] = [];
  for (let x = pad; x <= w - pad; x += 1) {
    const freq = Math.exp(Math.log(100) + ((x - pad) / (w - pad * 2)) * (Math.log(8000) - Math.log(100)));
    const ratio = freq / cutoff;
    let gain: number;

    if (filterType === "lowpass") {
      if (ratio < 0.9) gain = 1;
      else if (ratio < 1.1) { const d = Math.abs(ratio - 1) / 0.1; gain = 1 + resPeak * (1 - d); }
      else gain = Math.max(0.02, 1 / (ratio * ratio));
    } else if (filterType === "highpass") {
      if (ratio > 1.1) gain = 1;
      else if (ratio > 0.9) { const d = Math.abs(ratio - 1) / 0.1; gain = 1 + resPeak * (1 - d); }
      else gain = Math.max(0.02, ratio * ratio);
    } else if (filterType === "bandpass") {
      const dist = Math.abs(ratio - 1);
      if (dist < 0.15) gain = 1 + resPeak * (1 - dist / 0.15);
      else gain = Math.max(0.02, 1 / (1 + dist * dist * 10));
    } else {
      // notch
      const dist = Math.abs(ratio - 1);
      if (dist < 0.1) gain = Math.max(0.02, dist / 0.1 * 0.5);
      else gain = 1;
    }

    const y = h - pad - gain * (h - pad * 2) * 0.7;
    points.push(`${x},${Math.max(pad, Math.min(h - pad, y))}`);
  }

  return (
    <svg className="filter-curve" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <polyline points={points.join(" ")} fill="none" stroke={color} strokeWidth="2" />
      <line x1={cutX} y1={pad} x2={cutX} y2={h - pad} stroke={color} strokeWidth="0.5" strokeDasharray="2,2" opacity="0.5" />
    </svg>
  );
}

/** Static SVG of one-to-two cycles of an LFO shape. Amplitude scaled by depth. */
export function LfoCurve({ shape, depth, color = "currentColor" }: {
  shape: LfoShape; depth: number; color?: string;
}) {
  const w = 120, h = 36;
  // Derived from mpump's LFO polyline math; static (no rate), ~1.5 cycles.
  const cycles = 1.5;
  const pts = Array.from({ length: 80 }, (_, i) => {
    const t = i / 79;
    const phase = t * cycles;
    let y = 0;
    switch (shape) {
      case "sine": y = Math.sin(phase * Math.PI * 2); break;
      case "square": y = Math.sin(phase * Math.PI * 2) >= 0 ? 1 : -1; break;
      case "triangle": y = 2 * Math.abs(2 * (phase % 1) - 1) - 1; break;
      case "sawtooth": y = 2 * (phase % 1) - 1; break;
    }
    return `${4 + t * (w - 8)},${h / 2 - y * depth * (h / 2 - 4)}`;
  }).join(" ");

  return (
    <svg className="lfo-curve" viewBox={`0 0 ${w} ${h}`}>
      <line x1={4} y1={h / 2} x2={w - 4} y2={h / 2} stroke={color} strokeWidth={1} opacity={0.15} />
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} />
    </svg>
  );
}
