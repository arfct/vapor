// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { createElement } from "react";
import { renderWithDocument } from "../../helpers/document-context";
import ShareButton from "~/components/ShareButton";

describe("ShareButton", () => {
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
});
