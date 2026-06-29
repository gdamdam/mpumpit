// Synth/bass live-voice bookkeeping for AudioPort. Extracted as small, pure
// units so the ref-counting and late-load queueing can be unit-tested without a
// full Web Audio AudioContext (which jsdom lacks). Original work — AGPL-3.0-only.

/** The slice of CVOutput the gate tracker drives. */
export interface CvSink {
  setPitch(note: number, time?: number): void;
  setGate(on: boolean, time?: number): void;
}

function clampNote(n: number): number {
  const r = Math.round(n);
  if (!Number.isFinite(r)) return 60;
  return Math.max(0, Math.min(127, r));
}

/**
 * Ref-counted mono CV gate. The CV output exposes a single gate + pitch, so we
 * track every held (channel, note) pair: the gate only falls when the LAST
 * owner releases, with last-note pitch priority. Two channels (e.g. synth and
 * bass) holding the SAME pitch are independent owners — releasing one keeps the
 * gate high for the other, and a per-channel all-notes-off clears only that
 * channel's notes (a global panic clears everything via allOff).
 */
export class CvGateTracker {
  // key `${ch}:${note}` → owner, in insertion order (newest last for priority).
  private held = new Map<string, { ch: number; note: number }>();
  constructor(private readonly sink: CvSink) {}

  private key(ch: number, note: number): string {
    return `${ch}:${note}`;
  }

  noteOn(ch: number, note: number, time?: number): void {
    const n = clampNote(note);
    const k = this.key(ch, n);
    this.held.delete(k);
    this.held.set(k, { ch, note: n }); // (re)insert as the most-recent
    this.sink.setPitch(n, time);
    this.sink.setGate(true, time);
  }

  noteOff(ch: number, note: number, time?: number): void {
    this.held.delete(this.key(ch, clampNote(note)));
    this.repitchOrClose(time);
  }

  /** Release every note owned by one channel (per-channel all-notes-off). */
  channelOff(ch: number, time?: number): void {
    for (const [k, v] of this.held) if (v.ch === ch) this.held.delete(k);
    this.repitchOrClose(time);
  }

  /** Release everything (global panic / shutdown). */
  allOff(time?: number): void {
    this.held.clear();
    this.sink.setGate(false, time);
  }

  private repitchOrClose(time?: number): void {
    if (this.held.size > 0) {
      let last = 60;
      for (const v of this.held.values()) last = v.note; // newest = last inserted
      this.sink.setPitch(last, time); // re-pitch to newest held; gate stays high
    } else {
      this.sink.setGate(false, time);
    }
  }

  get size(): number {
    return this.held.size;
  }
}

/**
 * Bounded set of synth/bass notes held while the poly-synth worklet is still
 * loading. Keyed by channel+note so a release before the worklet arrives removes
 * the held note (Note On/Off correctness — released notes never replay), and a
 * re-press of an already-held key updates velocity without growing the queue.
 */
export class PendingLiveNotes {
  private held = new Map<string, { ch: number; note: number; vel: number }>();
  constructor(private readonly limit = 64) {}

  private key(ch: number, note: number): string {
    return `${ch}:${note}`;
  }

  /** Queue a held note. Returns false if dropped because the bound was reached. */
  add(ch: number, note: number, vel: number): boolean {
    const k = this.key(ch, note);
    if (!this.held.has(k) && this.held.size >= this.limit) return false;
    this.held.set(k, { ch, note, vel });
    return true;
  }

  remove(ch: number, note: number): void {
    this.held.delete(this.key(ch, note));
  }

  clearChannel(ch: number): void {
    for (const [k, v] of this.held) if (v.ch === ch) this.held.delete(k);
  }

  clear(): void {
    this.held.clear();
  }

  /** Return the held notes (insertion order) and empty the queue. */
  drain(): Array<{ ch: number; note: number; vel: number }> {
    const out = [...this.held.values()];
    this.held.clear();
    return out;
  }

  get size(): number {
    return this.held.size;
  }
}
