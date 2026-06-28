// Vitest setup — jsdom environment. Original work — AGPL-3.0-only.
import "@testing-library/jest-dom/vitest";

// Web MIDI is only exposed in a secure context; jsdom defaults isSecureContext
// to false, which would make MidiRouter.isSupported() short-circuit. Force it
// on so tests that mock navigator.requestMIDIAccess exercise the real path.
try {
  Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
} catch {
  /* ignore */
}

// jsdom's localStorage isn't reliably functional under vitest — install a
// simple in-memory Storage so persistence tests exercise real read/write paths.
function makeMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    removeItem: (k: string) => { map.delete(k); },
    setItem: (k: string, v: string) => { map.set(k, String(v)); },
  } as Storage;
}
if (typeof localStorage === "undefined" || typeof localStorage.setItem !== "function") {
  Object.defineProperty(globalThis, "localStorage", { value: makeMemoryStorage(), configurable: true });
}
