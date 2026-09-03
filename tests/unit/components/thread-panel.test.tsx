// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { render, fireEvent } from "@testing-library/react";
import ThreadPanel from "~/components/ThreadPanel";

const makeThread = (overrides = {}) => ({
  id: "t1",
  commentText: "Test comment",
  highlightText: undefined as string | undefined,
  author: { name: "Alice", color: "#E57373", colorLight: "#FFCDD2" },
  createdAt: Date.now(),
  resolved: false,
  replies: [] as Array<{
    id: string;
    author: { name: string; color: string; colorLight: string };
    text: string;
    createdAt: number;
  }>,
  position: 0,
  ...overrides,
});

describe("ThreadPanel", () => {
  const defaultProps = () => ({
    thread: makeThread(),
    active: false,
    onSelect: vi.fn(),
    onReply: vi.fn(),
    onResolve: vi.fn(),
    onDelete: vi.fn(),
  });

  it("renders author name, timestamp, and comment text", () => {
    const props = defaultProps();
    const { getByText } = render(createElement(ThreadPanel, props));

    expect(getByText("Alice")).toBeTruthy();
    expect(getByText("now")).toBeTruthy();
    expect(getByText("Test comment")).toBeTruthy();
  });

  it("tints the card with the author's colour when active", () => {
    const props = { ...defaultProps(), active: true };
    const { container } = render(createElement(ThreadPanel, props));

    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.style.getPropertyValue("--author-color")).toBe(props.thread.author.color);
    expect(wrapper.className).toContain("var(--author-color)");
  });

  it("has no active background when inactive", () => {
    const props = defaultProps();
    const { container } = render(createElement(ThreadPanel, props));

    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).not.toContain("bg-border/50");
    expect(wrapper.className).not.toContain("border-coral");
  });

  it("toggle: clicking active thread deselects (passes null)", () => {
    const props = { ...defaultProps(), active: true };
    const { container } = render(createElement(ThreadPanel, props));

    fireEvent.click(container.firstElementChild!);
    expect(props.onSelect).toHaveBeenCalledWith(null);
  });

  it("toggle: clicking inactive thread selects it", () => {
    const props = defaultProps();
    const { container } = render(createElement(ThreadPanel, props));

    fireEvent.click(container.firstElementChild!);
    expect(props.onSelect).toHaveBeenCalledWith("t1");
  });

  it("does not repeat the highlighted phrase in the card", () => {
    const props = {
      ...defaultProps(),
      thread: makeThread({ highlightText: "Some highlighted text" }),
    };
    const { queryByText } = render(createElement(ThreadPanel, props));

    expect(queryByText("Some highlighted text")).toBeFalsy();
  });

  it("renders replies with author header and text", () => {
    const props = {
      ...defaultProps(),
      thread: makeThread({
        replies: [
          {
            id: "r1",
            author: { name: "Bob", color: "#42A5F5", colorLight: "#BBDEFB" },
            text: "A reply",
            createdAt: Date.now(),
          },
        ],
      }),
    };
    const { getByText } = render(createElement(ThreadPanel, props));

    expect(getByText("Bob")).toBeTruthy();
    expect(getByText("A reply")).toBeTruthy();
  });

  it("renders resolve and overflow icons in the header", () => {
    const props = defaultProps();
    const { getByLabelText } = render(createElement(ThreadPanel, props));

    const resolveBtn = getByLabelText("Resolve");
    const moreBtn = getByLabelText("More actions");

    expect(resolveBtn.querySelector(".material-symbols-outlined")).toBeTruthy();
    expect(moreBtn.querySelector(".material-symbols-outlined")).toBeTruthy();
  });

  it("actions are hidden until hover on an inactive thread", () => {
    const props = defaultProps();
    const { getByLabelText } = render(createElement(ThreadPanel, props));

    const actions = getByLabelText("Resolve").parentElement as HTMLElement;
    expect(actions.className).toContain("opacity-0");
    expect(actions.className).toContain("group-hover:opacity-100");
  });

  it("actions are visible when the thread is active", () => {
    const props = { ...defaultProps(), active: true };
    const { getByLabelText } = render(createElement(ThreadPanel, props));

    const actions = getByLabelText("Resolve").parentElement as HTMLElement;
    expect(actions.className).toContain("opacity-100");
    expect(actions.className).not.toContain("opacity-0");
  });

  it("Delete lives in the overflow menu", () => {
    const props = defaultProps();
    const { getByLabelText, getByText, queryByText } = render(
      createElement(ThreadPanel, props),
    );

    expect(queryByText("Delete")).toBeFalsy();
    fireEvent.click(getByLabelText("More actions"));
    fireEvent.click(getByText("Delete"));
    expect(props.onDelete).toHaveBeenCalledWith("t1");
  });

  it("resolve button shows Reopen for resolved thread", () => {
    const props = {
      ...defaultProps(),
      thread: makeThread({ resolved: true }),
    };
    const { getByLabelText } = render(createElement(ThreadPanel, props));
    expect(getByLabelText("Reopen")).toBeTruthy();
  });

  it("resolve calls onResolve", () => {
    const props = defaultProps();
    const { getByLabelText } = render(createElement(ThreadPanel, props));

    fireEvent.click(getByLabelText("Resolve"));
    expect(props.onResolve).toHaveBeenCalledWith("t1");
  });

  it("reply link only appears on an active thread", () => {
    const props = defaultProps();
    const { queryByText } = render(createElement(ThreadPanel, props));
    expect(queryByText("Reply")).toBeFalsy();
  });

  it("reply input is hidden until the Reply link is clicked, then submits on Enter", () => {
    const props = { ...defaultProps(), active: true };
    const { getByText, queryByPlaceholderText, getByPlaceholderText } = render(
      createElement(ThreadPanel, props),
    );

    expect(queryByPlaceholderText("Reply...")).toBeFalsy();

    fireEvent.click(getByText("Reply"));
    const input = getByPlaceholderText("Reply...");
    expect(input.className).toContain("rounded-full");

    fireEvent.change(input, { target: { value: "My reply" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(props.onReply).toHaveBeenCalledWith("t1", "My reply");
  });

  it("action button clicks do not trigger thread selection", () => {
    const props = defaultProps();
    const { getByLabelText } = render(createElement(ThreadPanel, props));

    fireEvent.click(getByLabelText("Resolve"));
    expect(props.onSelect).not.toHaveBeenCalled();
  });
});
