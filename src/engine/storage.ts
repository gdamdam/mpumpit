/*
 * Derived from mpump (https://github.com/gdamdam) — Copyright (C) 2024-2026 gdamdam.
 * Part of mpump's AGPL-3.0-only audio engine, reused by mpumpit unmodified except
 * for import-path adjustments. Licensed under the GNU Affero General Public License
 * v3.0 only. See LICENSE and NOTICE.
 */
/**
 * Safe localStorage wrapper with try-catch and fallback defaults.
 * Prevents crashes in private browsing or when quota is exceeded.
 */

export function getItem(key: string, fallback = ""): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

export function setItem(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    // Quota exceeded or private browsing — report failure so callers can react
    return false;
  }
}

export function getBool(key: string, fallback = false): boolean {
  return getItem(key, fallback ? "1" : "0") === "1";
}

export function setBool(key: string, value: boolean): void {
  setItem(key, value ? "1" : "0");
}

export function getJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function setJSON(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    // Quota exceeded — report failure so callers can surface it instead of
    // silently losing the write (and falsely signalling success to the user).
    return false;
  }
}