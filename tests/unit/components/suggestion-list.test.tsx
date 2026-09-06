// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { createElement, createRef } from "react";
import { render, fireEvent, act } from "@testing-library/react";
import SuggestionList, { type SuggestionListHandle } from "~/components/SuggestionList";

const items = ["alpha", "beta", "gamma"];

function mount(command = vi.fn(), extra: Record<string, unknown> = {}) {
  const ref = createRef<SuggestionListHandle>();
  const utils = render(
    createElement(SuggestionList<string>, {
      ref,
      items,
      command,
      label: "Test",
      renderItem: (item: string) => createElement("span", null, item),
      ...extra,
    }),
  );
  return { ref, command, ...utils };
}

describe("SuggestionList", () => {
  it("arrow keys move the selection with wraparound; Enter picks", () => {
    const { ref, command, getAllByRole } = mount();
    const key = (k: string) => {
      let consumed = false;
      act(() => {
        consumed = ref.current!.onKeyDown(new KeyboardEvent("keydown", { key: k }));
      });
      return consumed;
    };
    expect(getAllByRole("option")[0].getAttribute("aria-selected")).toBe("true");
    expect(key("ArrowDown")).toBe(true);
    expect(getAllByRole("option")[1].getAttribute("aria-selected")).toBe("true");
    expect(key("ArrowUp")).toBe(true);
    expect(key("ArrowUp")).toBe(true);
    expect(getAllByRole("option")[2].getAttribute("aria-selected")).toBe("true");
    expect(key("Enter")).toBe(true);
    expect(command).toHaveBeenCalledWith("gamma");
    expect(key("a")).toBe(false);
  });

  it("Tab picks too, and mousedown picks without a click", () => {
    const { ref, command, getAllByRole } = mount();
    act(() => {
      ref.current!.onKeyDown(new KeyboardEvent("keydown", { key: "Tab" }));
    });
    expect(command).toHaveBeenLastCalledWith("alpha");
    fireEvent.mouseDown(getAllByRole("option")[1]);
    expect(command).toHaveBeenLastCalledWith("beta");
  });

  it("renders group headers when a grouper is given", () => {
    const { getByText } = mount(vi.fn(), { groupOf: (item: string) => (item === "gamma" ? "Greek" : "Latin") });
    expect(getByText("Latin")).toBeTruthy();
    expect(getByText("Greek")).toBeTruthy();
  });

  it("shows the empty message only when given one", () => {
    const ref = createRef<SuggestionListHandle>();
    const { container, rerender } = render(
      createElement(SuggestionList<string>, { ref, items: [], command: vi.fn(), label: "T", renderItem: () => null }),
    );
    expect(container.textContent).toBe("");
    rerender(
      createElement(SuggestionList<string>, {
        ref,
        items: [],
        command: vi.fn(),
        label: "T",
        renderItem: () => null,
        empty: "Nothing here",
      }),
    );
    expect(container.textContent).toBe("Nothing here");
  });
});
