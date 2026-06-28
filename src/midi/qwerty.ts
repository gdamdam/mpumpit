// Computer-keyboard MIDI input — Ableton-style QWERTY layout. Original work,
// AGPL-3.0-only.
//
// Layout (semitone offset from the base note):
//   A W S E D F T G Y H U J  →  C C# D D# E F F# G G# A A# B   (one octave)
//   K O L P ;                →  C C# D D# E   (next octave)
//   Z / X  →  octave down / up    C / V  →  velocity down / up
//
// The keyboard emits note on/off through callbacks; the App feeds them into the
// MidiRouter as a synthetic input so ownership, panic, and activity all apply.

export const QWERTY_SEMITONES: Record<string, number> = {
  a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11,
  k: 12, o: 13, l: 14, p: 15, ";": 16,
};

const MIN_OCTAVE_SHIFT = -4;
const MAX_OCTAVE_SHIFT = 4;
const VELOCITY_STEP = 12;

export interface QwertyOptions {
  onNoteOn: (note: number, velocity: number) => void;
  onNoteOff: (note: number) => void;
  onChange?: () => void;
  /** MIDI note for the 'a' key at octave shift 0. Default 60 (middle C). */
  baseNote?: number;
}

export class QwertyKeyboard {
  private enabled = false;
  private octaveShift = 0;
  private velocity = 100;
  private readonly baseNote: number;
  // key -> the exact note that was started, so key-up releases the right note
  // even if the octave changed while it was held.
  private sounding = new Map<string, number>();

  constructor(private readonly opts: QwertyOptions) {
    this.baseNote = opts.baseNote ?? 60;
  }

  isEnabled(): boolean { return this.enabled; }
  getOctaveShift(): number { return this.octaveShift; }
  getVelocity(): number { return this.velocity; }

  setEnabled(on: boolean): void {
    if (on === this.enabled) return;
    this.enabled = on;
    if (!on) this.releaseAll();
    this.opts.onChange?.();
  }

  private noteFor(key: string): number | null {
    const semi = QWERTY_SEMITONES[key];
    if (semi === undefined) return null;
    const note = this.baseNote + this.octaveShift * 12 + semi;
    return note >= 0 && note <= 127 ? note : null;
  }

  /** Handle a keydown. Returns true if the key was consumed. */
  handleKeyDown(key: string, repeat = false): boolean {
    if (!this.enabled) return false;
    const k = key.toLowerCase();
    if (k === "z") { this.shiftOctave(-1); return true; }
    if (k === "x") { this.shiftOctave(1); return true; }
    if (k === "c") { this.shiftVelocity(-VELOCITY_STEP); return true; }
    if (k === "v") { this.shiftVelocity(VELOCITY_STEP); return true; }
    if (!(k in QWERTY_SEMITONES)) return false;
    if (repeat || this.sounding.has(k)) return true; // ignore auto-repeat
    const note = this.noteFor(k);
    if (note === null) return true;
    this.sounding.set(k, note);
    this.opts.onNoteOn(note, this.velocity);
    return true;
  }

  /** Handle a keyup. Returns true if the key was consumed. */
  handleKeyUp(key: string): boolean {
    if (!this.enabled) return false;
    const k = key.toLowerCase();
    const note = this.sounding.get(k);
    if (note === undefined) return k in QWERTY_SEMITONES || k === "z" || k === "x" || k === "c" || k === "v";
    this.sounding.delete(k);
    this.opts.onNoteOff(note);
    return true;
  }

  /** Release every sounding note (e.g. on disable or panic). */
  releaseAll(): void {
    for (const note of this.sounding.values()) this.opts.onNoteOff(note);
    this.sounding.clear();
  }

  private shiftOctave(delta: number): void {
    const next = Math.max(MIN_OCTAVE_SHIFT, Math.min(MAX_OCTAVE_SHIFT, this.octaveShift + delta));
    if (next === this.octaveShift) return;
    // Release held notes so they don't hang at the old pitch.
    this.releaseAll();
    this.octaveShift = next;
    this.opts.onChange?.();
  }

  private shiftVelocity(delta: number): void {
    this.velocity = Math.max(1, Math.min(127, this.velocity + delta));
    this.opts.onChange?.();
  }
}
