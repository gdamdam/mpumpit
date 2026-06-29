import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { EffectEditor } from "../EffectEditor";
import { DEFAULT_EFFECTS } from "../../../engine/types";

afterEach(cleanup);

const noop = () => {};

describe("EffectEditor modal", () => {
  it("renders the effect title, an SVG visualization, and its sliders", () => {
    const { container } = render(
      <EffectEditor name="delay" params={{ ...DEFAULT_EFFECTS.delay, sync: false }}
        onUpdate={noop} onClose={noop} onReset={noop} />,
    );
    expect(screen.getByText("Delay")).toBeInTheDocument();
    expect(container.querySelector("svg.fx-vis")).toBeTruthy();
    // Time slider is visible when delay is NOT synced.
    expect(screen.getByText("Time")).toBeInTheDocument();
    expect(screen.getByText("Feedback")).toBeInTheDocument();
  });

  it("hides the Time slider when delay is synced (mpump behaviour)", () => {
    render(<EffectEditor name="delay" params={{ ...DEFAULT_EFFECTS.delay, sync: true }}
      onUpdate={noop} onClose={noop} onReset={noop} />);
    expect(screen.queryByText("Time")).toBeNull();
  });

  it("offers all four reverb types including spring", () => {
    render(<EffectEditor name="reverb" params={{ ...DEFAULT_EFFECTS.reverb }}
      onUpdate={noop} onClose={noop} onReset={noop} />);
    for (const t of ["ROOM", "HALL", "PLATE", "SPRING"]) {
      expect(screen.getByText(t)).toBeInTheDocument();
    }
  });

  it("emits onUpdate on slider change and onClose via ✕ and Escape", () => {
    const onUpdate = vi.fn();
    const onClose = vi.fn();
    render(<EffectEditor name="distortion" params={{ ...DEFAULT_EFFECTS.distortion }}
      onUpdate={onUpdate} onClose={onClose} onReset={noop} />);
    fireEvent.change(screen.getByRole("slider"), { target: { value: "50" } });
    expect(onUpdate).toHaveBeenCalledWith({ drive: 50 });
    fireEvent.click(screen.getByText("✕"));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
