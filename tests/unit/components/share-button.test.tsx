// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { renderWithDocument } from "../../helpers/document-context";
import ShareButton from "~/components/ShareButton";

function mockClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
}

function removeClipboard() {
  Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
}

describe("ShareButton", () => {
  afterEach(() => {
    removeClipboard();
    vi.restoreAllMocks();
  });

  it("opens with copy, download, and invite-an-agent rows", () => {
    renderWithDocument(createElement(ShareButton, { onOpenAgents: vi.fn() }));
    fireEvent.click(screen.getByLabelText("Share options"));

    expect(screen.getByText("Copy link")).toBeTruthy();
    expect(screen.getByText("Download")).toBeTruthy();
    expect(screen.getByText("Invite an agent")).toBeTruthy();
  });

  it("invite-an-agent row calls onOpenAgents", () => {
    const onOpenAgents = vi.fn();
    renderWithDocument(createElement(ShareButton, { onOpenAgents }));
    fireEvent.click(screen.getByLabelText("Share options"));
    fireEvent.click(screen.getByText("Invite an agent"));
    expect(onOpenAgents).toHaveBeenCalledOnce();
  });

  it("shows Copied after the link is written to the clipboard", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    mockClipboard(writeText);
    renderWithDocument(createElement(ShareButton));
    fireEvent.click(screen.getByLabelText("Share options"));
    fireEvent.click(screen.getByText("Copy link"));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(window.location.href));
    fireEvent.click(screen.getByLabelText("Share options"));
    await waitFor(() => expect(screen.getByText("Copied")).toBeTruthy());
  });

  it("shows Couldn't copy when the clipboard is unavailable and the fallback fails", async () => {
    removeClipboard();
    document.execCommand = vi.fn(() => false);
    renderWithDocument(createElement(ShareButton));
    fireEvent.click(screen.getByLabelText("Share options"));
    fireEvent.click(screen.getByText("Copy link"));

    fireEvent.click(screen.getByLabelText("Share options"));
    await waitFor(() => expect(screen.getByText("Couldn't copy")).toBeTruthy());
  });
});
