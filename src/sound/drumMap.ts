// midip ↔ mpump drum-note compatibility map. Original work — AGPL-3.0-only.
//
// Why this exists
// ───────────────
// midip sends GM-ish drum notes on channel 10. mpump's drum engine
// (drumSynth.DRUM_SYNTHS) is keyed by MIDI note number with ITS OWN voice
// assignment, which is GM-ish but NOT full General MIDI. Matching note numbers
// do NOT guarantee matching instruments, so we keep an explicit, documented map.
//
// midip drum lanes (from midip's instrument-design spec):
//   36 BD · 37 RS · 38 SD · 42 CH · 46 OH · 47 MT · 49 CC · 50 HT · 51 RC · 56 CB
//
// mpump's synthesizable drum voices (drumSynth.DRUM_SYNTHS — note → voice):
//   36 kick · 37 rimshot · 38 snare · 42 closed-hat · 46 open-hat ·
//   47 cowbell · 49 crash · 50 clap · 51 ride · 56 cowbell
//
// Alignment / divergence for the 10 midip notes:
//   36, 38, 42, 46, 49, 51 — match (kick/snare/hats/crash/ride).
//   37 RS — both "rimshot": match.
//   47 — midip Mid-Tom vs mpump COWBELL. mpump has no tom voices.
//   50 — midip High-Tom vs mpump CLAP. mpump has no tom voices.
//   56 — midip Cowbell → mpump cowbell: match (and 47 also = cowbell).
//
// Every one of the 10 midip notes resolves to an AUDIBLE mpump voice, so the
// default map is identity (pass-through). The two tom lanes (47, 50) sound as
// cowbell/clap because mpump synthesizes no toms; users may remap them.

/** Human-readable label for each midip drum lane. */
export const MIDIP_DRUM_LANES: Record<number, string> = {
  36: "BD (kick)",
  37: "RS (rimshot)",
  38: "SD (snare)",
  42: "CH (closed hat)",
  46: "OH (open hat)",
  47: "MT (mid tom)",
  49: "CC (crash)",
  50: "HT (high tom)",
  51: "RC (ride)",
  56: "CB (cowbell)",
};

/** Label for what each note actually plays in mpump's engine. */
export const MPUMP_DRUM_VOICE_LABELS: Record<number, string> = {
  36: "kick",
  37: "rimshot",
  38: "snare",
  42: "closed hat",
  46: "open hat",
  47: "cowbell",
  49: "crash",
  50: "clap",
  51: "ride",
  56: "cowbell",
};

/** MIDI notes mpump can actually synthesize (drumSynth.DRUM_SYNTHS keys). */
export const MPUMP_PLAYABLE_DRUM_NOTES: ReadonlySet<number> = new Set(
  Object.keys(MPUMP_DRUM_VOICE_LABELS).map(Number),
);

/**
 * Default compatibility map: incoming MIDI note → mpump voice note.
 * Identity for all 10 midip lanes (every one is audible in mpump).
 */
export const DEFAULT_DRUM_MAP: Readonly<Record<number, number>> = Object.freeze(
  Object.keys(MIDIP_DRUM_LANES).reduce<Record<number, number>>((acc, k) => {
    const n = Number(k);
    acc[n] = n;
    return acc;
  }, {}),
);

/**
 * Resolve an incoming drum note to the mpump voice note that should play, using
 * an optional override map. Returns `null` if the (possibly remapped) note has
 * no mpump voice — callers must NOT trigger a voice in that case.
 */
export function mapDrumNote(
  incoming: number,
  overrides?: Record<number, number>,
): number | null {
  const mapped = overrides?.[incoming] ?? DEFAULT_DRUM_MAP[incoming] ?? incoming;
  return MPUMP_PLAYABLE_DRUM_NOTES.has(mapped) ? mapped : null;
}
