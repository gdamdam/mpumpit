// MIDI domain types for mpumpit. Original work — AGPL-3.0-only.

/** The three logical instrument parts mpumpit exposes. */
export type Part = "synth" | "bass" | "drums";

export const PARTS: readonly Part[] = ["synth", "bass", "drums"] as const;

/**
 * AudioPort channel for each part. These are fixed by mpump's engine:
 * channel 0 = synth, 1 = bass, 9 = GM drums. (See AudioPort: DRUM_CH = 9.)
 */
export const PART_TO_AUDIO_CH: Record<Part, number> = {
  synth: 0,
  bass: 1,
  drums: 9,
};

/** Default *incoming* MIDI channel (1–16, human-facing) routed to each part. */
export const DEFAULT_CHANNELS: Record<Part, number> = {
  synth: 1,
  bass: 2,
  drums: 10,
};

/**
 * A parsed inbound MIDI message. `channel` is 1–16 (human-facing) to match the
 * channel numbers the user configures. System real-time / common messages
 * carry no channel and decode to `clock` (ignored, but never an error) or
 * `ignored`.
 */
export type MidiEvent =
  | { kind: "noteOn"; channel: number; note: number; velocity: number }
  | { kind: "noteOff"; channel: number; note: number }
  | { kind: "allNotesOff"; channel: number; controller: number } // CC 120 / 123
  | { kind: "clock" } // 0xF8–0xFF system real-time (incl. clock/start/stop)
  | { kind: "ignored" };
