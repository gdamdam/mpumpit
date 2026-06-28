// Live MIDI message decoding. Original work — AGPL-3.0-only.
//
// Byte conventions mirror mpump's offline .mid parser (utils/midi.ts):
//   status & 0xf0 = message type, status & 0x0f = channel (0–15).
//   A Note On with velocity 0 is treated as a Note Off.
// Live Web MIDI always delivers a complete message with its own status byte,
// so running status (used in .mid files) does not occur here.

import type { MidiEvent } from "./types";

// MIDI status nibbles
const NOTE_OFF = 0x80;
const NOTE_ON = 0x90;
const CONTROL_CHANGE = 0xb0;

// Channel-mode controllers used for panic
const CC_ALL_SOUND_OFF = 120;
const CC_ALL_NOTES_OFF = 123;

/**
 * Decode one raw MIDI message into a structured {@link MidiEvent}.
 *
 * - 0xF8–0xFF (system real-time: clock, start, continue, stop, …) → `clock`
 *   so callers can ignore them without erroring. MIDI Clock sync is deferred.
 * - 0xF0–0xF7 (system common / SysEx) → `ignored`.
 * - Note On with velocity 0 → `noteOff`.
 * - CC 120 (All Sound Off) / 123 (All Notes Off) → `allNotesOff`.
 * - Everything else (aftertouch, pitch bend, program change, other CC) →
 *   `ignored`.
 */
export function parseMidiMessage(data: Uint8Array | ReadonlyArray<number>): MidiEvent {
  if (!data || data.length === 0) return { kind: "ignored" };

  const status = data[0];

  // System real-time (single status byte, no payload) — clock & transport.
  if (status >= 0xf8) return { kind: "clock" };
  // System common / SysEx — not used by mpumpit.
  if (status >= 0xf0) return { kind: "ignored" };

  const type = status & 0xf0;
  const channel = (status & 0x0f) + 1; // 1–16, matches user-facing config

  switch (type) {
    case NOTE_ON: {
      const note = data[1] ?? 0;
      const velocity = data[2] ?? 0;
      // Note On with velocity 0 is a Note Off (running-status convention).
      if (velocity === 0) return { kind: "noteOff", channel, note };
      return { kind: "noteOn", channel, note, velocity };
    }
    case NOTE_OFF: {
      const note = data[1] ?? 0;
      return { kind: "noteOff", channel, note };
    }
    case CONTROL_CHANGE: {
      const controller = data[1] ?? 0;
      if (controller === CC_ALL_SOUND_OFF || controller === CC_ALL_NOTES_OFF) {
        return { kind: "allNotesOff", channel, controller };
      }
      return { kind: "ignored" };
    }
    default:
      // Polyphonic/channel aftertouch, pitch bend, program change, etc.
      return { kind: "ignored" };
  }
}
