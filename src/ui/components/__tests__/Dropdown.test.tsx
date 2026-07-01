// Tests for the custom cross-browser Dropdown. Original work — AGPL-3.0-only.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { Dropdown } from "../Dropdown";

afterEach(cleanup);

describe("Dropdown", () => {
  it("shows the selected option's label on the trigger", () => {
    render(<Dropdown value="b" options={["a", "b", "c"]} onChange={() => {}} ariaLabel="letters" />);
    expect(screen.getByRole("button", { name: /letters/ })).toHaveTextContent("b");
  });

  it("opens the listbox on trigger click and lists every option", () => {
    render(<Dropdown value="a" options={["a", "b", "c"]} onChange={() => {}} ariaLabel="letters" />);
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /letters/ }));
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(3);
  });

  it("calls onChange with the value and closes when an option is chosen", () => {
    const onChange = vi.fn();
    render(<Dropdown value="a" options={["a", "b", "c"]} onChange={onChange} ariaLabel="letters" />);
    fireEvent.click(screen.getByRole("button", { name: /letters/ }));
    fireEvent.click(screen.getByRole("option", { name: "c" }));
    expect(onChange).toHaveBeenCalledWith("c");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("supports {value,label} options — displays the label, emits the value", () => {
    const onChange = vi.fn();
    render(
      <Dropdown
        value="in-1"
        options={[{ value: "in-1", label: "Keystation" }, { value: "in-2", label: "Launchpad" }]}
        onChange={onChange}
        ariaLabel="midi"
      />,
    );
    expect(screen.getByRole("button", { name: /midi/ })).toHaveTextContent("Keystation");
    fireEvent.click(screen.getByRole("button", { name: /midi/ }));
    fireEvent.click(screen.getByRole("option", { name: "Launchpad" }));
    expect(onChange).toHaveBeenCalledWith("in-2");
  });

  it("renders grouped options with their group headings", () => {
    render(
      <Dropdown
        value="init"
        groups={[
          { label: "Presets", options: [{ value: "init", label: "init" }, { value: "warm", label: "warm" }] },
          { label: "User", options: [{ value: "mine", label: "mine" }] },
        ]}
        onChange={() => {}}
        ariaLabel="preset"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /preset/ }));
    expect(screen.getByText("Presets")).toBeInTheDocument();
    expect(screen.getByText("User")).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(3);
  });

  it("navigates with the arrow keys and commits with Enter", () => {
    const onChange = vi.fn();
    render(<Dropdown value="a" options={["a", "b", "c"]} onChange={onChange} ariaLabel="letters" />);
    const trigger = screen.getByRole("button", { name: /letters/ });
    fireEvent.click(trigger); // opens, active = "a"
    fireEvent.keyDown(trigger, { key: "ArrowDown" }); // active = "b"
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("b");
  });

  it("closes on Escape and on an outside click", () => {
    render(<Dropdown value="a" options={["a", "b"]} onChange={() => {}} ariaLabel="letters" />);
    const trigger = screen.getByRole("button", { name: /letters/ });
    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();

    fireEvent.click(trigger);
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("swallows key events while open so instrument keys don't fire", () => {
    const windowKey = vi.fn();
    window.addEventListener("keydown", windowKey);
    try {
      render(<Dropdown value="a" options={["a", "b"]} onChange={() => {}} ariaLabel="letters" />);
      const trigger = screen.getByRole("button", { name: /letters/ });
      fireEvent.click(trigger); // open
      fireEvent.keyDown(trigger, { key: "a" }); // a note key — must not reach window
      expect(windowKey).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", windowKey);
    }
  });
});
