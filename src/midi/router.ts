// MIDI input router. Original work — AGPL-3.0-only.
//
// Owns the inbound MIDI path mpump never had: enumerate inputs, route by
// channel to a part, and track active-note ownership so duplicate Note Ons,
// late Note Offs, device removal and config changes never leave hung notes.
//
// Ownership model:
//   owners:    "<inputId>|<channel>|<incomingNote>" -> { part, engineNote }
//   voiceRefs: "<part>|<engineNote>" -> Set<ownerKey>
// The engine voice (poly-synth) is keyed by (audioChannel, note), so two inputs
// holding the same part+note SHARE one voice. We ref-count holders and only
// send engine noteOff when the LAST holder releases.
//
// No MIDIOutput is ever created → there is no possibility of a feedback loop.

import { parseMidiMessage } from "./parse";
import {
  DEFAULT_CHANNELS, PARTS, type Part,
} from "./types";
import { mapDrumNote } from "../sound/drumMap";

export interface NoteSink {
  noteOn(part: Part, note: number, velocity: number): void;
  noteOff(part: Part, note: number): void;
  panic?(): void;
}

export type MidiPermissionState = "idle" | "unsupported" | "denied" | "granted";

export interface MidiInputInfo {
  id: string;
  name: string;
  manufacturer: string;
  connected: boolean;
}

/** Sentinel for "listen to every input". */
export const ALL_INPUTS = "all";

export interface MidiRouterOptions {
  sink: NoteSink;
  channels?: Record<Part, number>;
  drumMap?: Record<number, number>;
  selectedInputId?: string; // device id, ALL_INPUTS, or "" for none
  /** Fired when inputs appear/disappear or permission changes. */
  onStateChange?: () => void;
  /** Fired when a note is routed to a part (for activity indicators). */
  onActivity?: (part: Part) => void;
  /** Fired on ANY inbound channel-voice message, routed or not (MIDI-IN LED). */
  onRawActivity?: () => void;
}

export class MidiRouter {
  private readonly sink: NoteSink;
  private channels: Record<Part, number>;
  private drumMap: Record<number, number>;
  private selectedInputId: string;
  private readonly onStateChange?: () => void;
  private readonly onActivity?: (part: Part) => void;
  private readonly onRawActivity?: () => void;

  private access: MIDIAccess | null = null;
  private permission: MidiPermissionState = "idle";
  private disposed = false;
  private rxCount = 0;
  private clockCount = 0;

  // inputId -> bound message handler currently attached
  private handlers = new Map<string, (e: MIDIMessageEvent) => void>();

  private owners = new Map<string, { part: Part; engineNote: number }>();
  private voiceRefs = new Map<string, Set<string>>();

  constructor(opts: MidiRouterOptions) {
    this.sink = opts.sink;
    this.channels = { ...DEFAULT_CHANNELS, ...(opts.channels ?? {}) };
    this.drumMap = { ...(opts.drumMap ?? {}) };
    this.selectedInputId = opts.selectedInputId ?? ALL_INPUTS;
    this.onStateChange = opts.onStateChange;
    this.onActivity = opts.onActivity;
    this.onRawActivity = opts.onRawActivity;
  }

  // ── Access / enumeration ───────────────────────────────────────────────────

  getPermission(): MidiPermissionState {
    return this.permission;
  }

  static isSupported(): boolean {
    return typeof navigator !== "undefined" &&
      typeof navigator.requestMIDIAccess === "function" &&
      (typeof window === "undefined" || window.isSecureContext !== false);
  }

  async enable(): Promise<MidiPermissionState> {
    if (!MidiRouter.isSupported()) {
      this.permission = "unsupported";
      this.onStateChange?.();
      return this.permission;
    }
    let access: MIDIAccess;
    try {
      // sysex:false — we never need it, and it avoids an extra permission prompt.
      access = await navigator.requestMIDIAccess({ sysex: false });
    } catch {
      this.permission = "denied";
      this.onStateChange?.();
      return this.permission;
    }
    // Guard against React StrictMode's mount→unmount→mount: if we were disposed
    // while requestMIDIAccess was pending, don't attach a zombie listener set.
    if (this.disposed) return this.permission;
    this.access = access;
    this.permission = "granted";
    // Hot-plug: refresh listeners + notify UI whenever the device set changes.
    this.access.onstatechange = () => this.handleStateChange();
    this.attachListeners();
    this.onStateChange?.();
    return this.permission;
  }

  listInputs(): MidiInputInfo[] {
    if (!this.access) return [];
    const out: MidiInputInfo[] = [];
    this.access.inputs.forEach((input) => {
      out.push({
        id: input.id,
        name: input.name ?? "Unknown",
        manufacturer: input.manufacturer ?? "",
        connected: input.state === "connected",
      });
    });
    return out;
  }

  getSelectedInputId(): string {
    return this.selectedInputId;
  }

  /** True when the current selection has at least one connected input. */
  hasActiveInput(): boolean {
    return this.handlers.size > 0;
  }

  /** Number of inputs currently being listened to (diagnostics). */
  getListenerCount(): number {
    return this.handlers.size;
  }

  /** Count of channel-voice messages received since start (diagnostics). */
  getReceivedCount(): number {
    return this.rxCount;
  }

  setSelectedInput(id: string): void {
    if (id === this.selectedInputId) return;
    this.releaseAll(); // notes from the old selection must not hang
    this.selectedInputId = id;
    this.attachListeners();
    this.onStateChange?.();
  }

  getChannels(): Record<Part, number> {
    return { ...this.channels };
  }

  setChannels(channels: Partial<Record<Part, number>>): void {
    this.releaseAll(); // routing changed — release everything currently held
    this.channels = { ...this.channels, ...channels };
    this.onStateChange?.();
  }

  setDrumMap(overrides: Record<number, number>): void {
    this.releaseAll();
    this.drumMap = { ...overrides };
  }

  // ── Listener management ─────────────────────────────────────────────────────

  private attachListeners(): void {
    this.detachListeners();
    if (!this.access) return;
    this.access.inputs.forEach((input) => {
      if (input.state !== "connected") return;
      if (this.selectedInputId !== ALL_INPUTS && input.id !== this.selectedInputId) return;
      const handler = (e: MIDIMessageEvent) => this.handleMessage(input.id, e.data);
      // Set `onmidimessage` (the IDL attribute), NOT addEventListener: per the
      // Web MIDI spec this is what implicitly OPENS the input port, and Chrome
      // only delivers messages from an open port. addEventListener alone leaves
      // the port closed, so virtual buses (macOS IAC, loopMIDI) stay silent.
      input.onmidimessage = handler;
      this.handlers.set(input.id, handler);
      // open() is belt-and-suspenders (onmidimessage already opens the port).
      // It returns a promise — catch rejection so it isn't unhandled, and if the
      // port genuinely failed to open, stop reporting it as listened-to.
      try {
        const opened = (input as unknown as { open?: () => Promise<unknown> }).open?.();
        opened?.catch?.(() => {
          if (this.handlers.get(input.id) === handler) {
            try { input.onmidimessage = null; } catch { /* */ }
            this.handlers.delete(input.id);
            this.onStateChange?.();
          }
        });
      } catch { /* sync throw — ignore */ }
    });
  }

  private detachListeners(): void {
    if (this.access) {
      this.access.inputs.forEach((input) => {
        if (this.handlers.has(input.id)) input.onmidimessage = null;
      });
    }
    this.handlers.clear();
  }

  private handleStateChange(): void {
    // An input we were listening to may have vanished — release its notes.
    if (this.access) {
      const present = new Set<string>();
      this.access.inputs.forEach((i) => { if (i.state === "connected") present.add(i.id); });
      for (const id of [...this.handlers.keys()]) {
        if (!present.has(id)) this.releaseInput(id);
      }
    }
    // Re-attach so newly connected inputs are heard and removed ones are dropped.
    this.attachListeners();
    this.onStateChange?.();
  }

  // ── Message handling ────────────────────────────────────────────────────────

  /** Public for tests; normally invoked from the midimessage listener. */
  handleMessage(inputId: string, data: Uint8Array | ReadonlyArray<number> | null | undefined): void {
    if (!data || data.length === 0) return;
    // Count EVERY inbound message (notes, CC, pitch bend, program change, clock,
    // sysex) so "MIDI rx" reliably shows whether anything is arriving at all.
    this.rxCount++;
    const ev = parseMidiMessage(data);
    // Blink the MIDI-IN indicator on any real message. Clock would hold the LED
    // solid at 24 PPQN, so signal it only ~once per quarter note — enough to
    // refresh the diagnostics counter so a clock-only device isn't shown as
    // "MIDI rx 0" forever, without a solid LED.
    if (ev.kind === "clock") {
      if (++this.clockCount % 24 === 0) this.onRawActivity?.();
    } else {
      this.onRawActivity?.();
    }
    switch (ev.kind) {
      case "noteOn":
        this.routeNoteOn(inputId, ev.channel, ev.note, ev.velocity);
        break;
      case "noteOff":
        this.routeNoteOff(inputId, ev.channel, ev.note);
        break;
      case "allNotesOff":
        this.releaseChannel(inputId, ev.channel);
        break;
      case "clock": // MIDI clock / transport — ignored, never an error.
      case "ignored":
        break;
    }
  }

  private partForChannel(channel: number): Part | null {
    for (const part of PARTS) {
      if (this.channels[part] === channel) return part;
    }
    return null;
  }

  private routeNoteOn(inputId: string, channel: number, note: number, velocity: number): void {
    const part = this.partForChannel(channel);
    if (!part) return;

    let engineNote = note;
    if (part === "drums") {
      const mapped = mapDrumNote(note, this.drumMap);
      if (mapped === null) return; // no mpump voice for this drum note
      engineNote = mapped;
    }

    const ownerKey = `${inputId}|${channel}|${note}`;
    // Duplicate Note On from the same holder is a retrigger, not a new ref.
    const existing = this.owners.get(ownerKey);
    if (existing) this.removeRef(existing.part, existing.engineNote, ownerKey);

    this.owners.set(ownerKey, { part, engineNote });
    this.addRef(part, engineNote, ownerKey);
    this.sink.noteOn(part, engineNote, velocity);
    this.onActivity?.(part);
  }

  private routeNoteOff(inputId: string, channel: number, note: number): void {
    const ownerKey = `${inputId}|${channel}|${note}`;
    const owner = this.owners.get(ownerKey);
    if (!owner) return; // late / unmatched Note Off — ignore, no hung note
    this.owners.delete(ownerKey);
    this.releaseRef(owner.part, owner.engineNote, ownerKey);
  }

  // CC 120 / 123 on a channel: release everything that input holds on it.
  private releaseChannel(inputId: string, channel: number): void {
    const prefix = `${inputId}|${channel}|`;
    for (const key of [...this.owners.keys()]) {
      if (key.startsWith(prefix)) {
        const owner = this.owners.get(key)!;
        this.owners.delete(key);
        this.releaseRef(owner.part, owner.engineNote, key);
      }
    }
  }

  /** Release every note owned by an input (call on disconnect). */
  releaseInput(inputId: string): void {
    const prefix = `${inputId}|`;
    for (const key of [...this.owners.keys()]) {
      if (key.startsWith(prefix)) {
        const owner = this.owners.get(key)!;
        this.owners.delete(key);
        this.releaseRef(owner.part, owner.engineNote, key);
      }
    }
    if (this.handlers.has(inputId) && this.access) {
      const input = this.access.inputs.get(inputId);
      if (input) input.onmidimessage = null;
      this.handlers.delete(inputId);
    }
  }

  /**
   * Play a note routed DIRECTLY to a part — bypassing channel routing and the
   * drum-map — while sharing the SAME active-note ownership as inbound MIDI.
   * So if a controller and the computer keyboard hold the same part+note, the
   * engine voice is ref-counted and only silenced when the LAST holder releases.
   * `ownerId` namespaces the source (e.g. "qwerty-keyboard").
   */
  directNoteOn(ownerId: string, part: Part, note: number, velocity: number): void {
    const ownerKey = `${ownerId}|${part}|${note}`;
    const existing = this.owners.get(ownerKey);
    if (existing) this.removeRef(existing.part, existing.engineNote, ownerKey);
    this.owners.set(ownerKey, { part, engineNote: note });
    this.addRef(part, note, ownerKey);
    this.sink.noteOn(part, note, velocity);
    this.onActivity?.(part);
  }

  directNoteOff(ownerId: string, part: Part, note: number): void {
    const ownerKey = `${ownerId}|${part}|${note}`;
    const owner = this.owners.get(ownerKey);
    if (!owner) return;
    this.owners.delete(ownerKey);
    this.releaseRef(owner.part, owner.engineNote, ownerKey);
  }

  /** Release all active notes for one part (e.g. before a preset change). */
  releasePart(part: Part): void {
    for (const key of [...this.owners.keys()]) {
      const owner = this.owners.get(key)!;
      if (owner.part === part) {
        this.owners.delete(key);
        this.releaseRef(owner.part, owner.engineNote, key);
      }
    }
  }

  /** Release every tracked note. */
  releaseAll(): void {
    for (const key of [...this.owners.keys()]) {
      const owner = this.owners.get(key)!;
      this.releaseRef(owner.part, owner.engineNote, key);
    }
    this.owners.clear();
    this.voiceRefs.clear();
  }

  /** Hard panic: release tracking AND tell the sink to silence the engine. */
  panic(): void {
    this.releaseAll();
    this.sink.panic?.();
  }

  /** Number of currently sounding engine voices (for diagnostics/tests). */
  get activeVoiceCount(): number {
    return this.voiceRefs.size;
  }

  dispose(): void {
    this.disposed = true;
    this.detachListeners();
    if (this.access) this.access.onstatechange = null;
    this.owners.clear();
    this.voiceRefs.clear();
    this.access = null;
  }

  // ── Ref counting ────────────────────────────────────────────────────────────

  private addRef(part: Part, engineNote: number, ownerKey: string): void {
    const refKey = `${part}|${engineNote}`;
    let set = this.voiceRefs.get(refKey);
    if (!set) { set = new Set(); this.voiceRefs.set(refKey, set); }
    set.add(ownerKey);
  }

  private removeRef(part: Part, engineNote: number, ownerKey: string): void {
    const refKey = `${part}|${engineNote}`;
    const set = this.voiceRefs.get(refKey);
    if (!set) return;
    set.delete(ownerKey);
    if (set.size === 0) this.voiceRefs.delete(refKey);
  }

  // Remove a holder and send engine noteOff when it was the last one.
  private releaseRef(part: Part, engineNote: number, ownerKey: string): void {
    const refKey = `${part}|${engineNote}`;
    const set = this.voiceRefs.get(refKey);
    if (!set) return;
    set.delete(ownerKey);
    if (set.size === 0) {
      this.voiceRefs.delete(refKey);
      this.sink.noteOff(part, engineNote);
    }
  }
}
