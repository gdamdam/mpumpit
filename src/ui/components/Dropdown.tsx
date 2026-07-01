// A custom listbox dropdown that renders identically on every browser/OS —
// native <select> popups are drawn by the platform and can't be styled. Keeps
// focus on the trigger and drives the list via aria-activedescendant.
// Original work — AGPL-3.0-only.
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";

export type DropdownOption = { value: string; label: string; disabled?: boolean };
export type DropdownGroup = { label: string; options: DropdownOption[] };

function normalize(options?: readonly (string | DropdownOption)[]): DropdownOption[] {
  return (options ?? []).map((o) => (typeof o === "string" ? { value: o, label: o } : o));
}

/** Cross-browser replacement for a styled native <select>. */
export function Dropdown(props: {
  value: string;
  /** Flat option list; strings are used as both value and label. */
  options?: readonly (string | DropdownOption)[];
  /** Grouped options (mutually exclusive with `options`). */
  groups?: readonly DropdownGroup[];
  onChange: (v: string) => void;
  className?: string;
  ariaLabel?: string;
  title?: string;
}) {
  const { value, groups, onChange, className, ariaLabel, title } = props;
  const flat: DropdownOption[] = groups ? groups.flatMap((g) => g.options) : normalize(props.options);

  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0); // highlighted index into `flat`
  const [openUp, setOpenUp] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const baseId = useId();

  const selectedIndex = Math.max(0, flat.findIndex((o) => o.value === value));
  const current = flat[selectedIndex];

  const openList = () => {
    setActive(selectedIndex);
    // Flip upward when there's little room below and more room above.
    const rect = rootRef.current?.getBoundingClientRect();
    if (rect) {
      const below = window.innerHeight - rect.bottom;
      setOpenUp(below < 240 && rect.top > below);
    }
    setOpen(true);
  };
  const close = () => setOpen(false);

  const commit = (i: number) => {
    const opt = flat[i];
    if (!opt || opt.disabled) return;
    if (opt.value !== value) onChange(opt.value);
    close();
  };

  // Advance the highlight by `delta`, wrapping and skipping disabled options.
  const move = (delta: number) => {
    if (!flat.length) return;
    let i = active;
    for (let step = 0; step < flat.length; step++) {
      i = (i + delta + flat.length) % flat.length;
      if (!flat[i].disabled) break;
    }
    setActive(i);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return; // let real shortcuts pass through
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " ", "Spacebar"].includes(e.key)) {
        e.preventDefault();
        e.stopPropagation();
        openList();
      }
      return;
    }
    // While open, swallow every key so the window-level instrument keyboard
    // (see App.tsx onKeyDown) never turns menu navigation into notes.
    e.stopPropagation();
    switch (e.key) {
      case "ArrowDown": e.preventDefault(); move(1); break;
      case "ArrowUp": e.preventDefault(); move(-1); break;
      case "Home": e.preventDefault(); setActive(0); break;
      case "End": e.preventDefault(); setActive(flat.length - 1); break;
      case "Enter":
      case " ":
      case "Spacebar": e.preventDefault(); commit(active); break;
      case "Escape": e.preventDefault(); close(); break;
      case "Tab": close(); break; // let focus move on naturally
      default: break;
    }
  };

  const onKeyUp = (e: React.KeyboardEvent) => {
    if (open) e.stopPropagation();
  };

  // Close on an outside click.
  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close();
    };
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [open]);

  // Keep the highlighted option in view. scrollIntoView is guarded for jsdom.
  useLayoutEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    el?.scrollIntoView?.({ block: "nearest" });
  }, [open, active]);

  const renderOption = (opt: DropdownOption, i: number): ReactNode => (
    <li
      key={`${i}-${opt.value}`}
      id={`${baseId}-opt-${i}`}
      data-idx={i}
      role="option"
      aria-selected={i === selectedIndex}
      aria-disabled={opt.disabled || undefined}
      className={
        "dd-option" +
        (i === active ? " is-active" : "") +
        (i === selectedIndex ? " is-selected" : "") +
        (opt.disabled ? " is-disabled" : "")
      }
      onMouseEnter={() => { if (!opt.disabled) setActive(i); }}
      onMouseDown={(e) => e.preventDefault()} // keep focus on the trigger
      onClick={() => commit(i)}
    >
      {opt.label}
    </li>
  );

  // Build list items, tagging group headers as presentational rows.
  let items: ReactNode[];
  if (groups) {
    const out: ReactNode[] = [];
    let i = -1;
    for (const g of groups) {
      out.push(
        <li key={`g-${g.label}`} role="presentation" className="dd-group-label">{g.label}</li>,
      );
      for (const o of g.options) { i++; out.push(renderOption(o, i)); }
    }
    items = out;
  } else {
    items = flat.map((o, i) => renderOption(o, i));
  }

  return (
    <div className={"dd" + (className ? " " + className : "")} ref={rootRef} title={title}>
      <button
        type="button"
        className="dd-trigger"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-activedescendant={open ? `${baseId}-opt-${active}` : undefined}
        onClick={() => (open ? close() : openList())}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
      >
        <span className="dd-value">{current ? current.label : ""}</span>
        <span className="dd-caret" aria-hidden="true">▾</span>
      </button>
      {open && (
        <ul className={"dd-list" + (openUp ? " dd-up" : "")} role="listbox" aria-label={ariaLabel} ref={listRef}>
          {items}
        </ul>
      )}
    </div>
  );
}
