// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { act } from "@testing-library/react";
import { renderWithDocument, createMockDocumentContext } from "../../helpers/document-context";
import ConnectionStatus from "~/components/ConnectionStatus";

function yjsWith(overrides: Record<string, unknown>) {
  const base = createMockDocumentContext().yjs;
  return { ...base, ...overrides } as never;
}

describe("ConnectionStatus", () => {
  it("shows Connecting before any connection", () => {
    const { getByText } = renderWithDocument(createElement(ConnectionStatus), {
      context: { yjs: yjsWith({ socket: null }) },
    });
    expect(getByText("Connecting")).toBeTruthy();
  });

  it("shows Sleeping when the tab is asleep", () => {
    const { getByText } = renderWithDocument(createElement(ConnectionStatus), {
      context: { yjs: yjsWith({ socket: null, asleep: true }) },
    });
    expect(getByText("Sleeping")).toBeTruthy();
  });

  it("shows Offline when the browser loses the network", () => {
    const { getByText } = renderWithDocument(createElement(ConnectionStatus), {
      context: { yjs: yjsWith({ socket: null }) },
    });
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(getByText("Offline")).toBeTruthy();
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(getByText("Connecting")).toBeTruthy();
  });

  it("shows Connected on an open socket and Reconnecting after it drops", () => {
    const listeners = new Map<string, Set<() => void>>();
    const socket = {
      readyState: WebSocket.OPEN,
      addEventListener(type: string, fn: () => void) {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type)!.add(fn);
      },
      removeEventListener(type: string, fn: () => void) {
        listeners.get(type)?.delete(fn);
      },
    };
    const { getByText } = renderWithDocument(createElement(ConnectionStatus), {
      context: { yjs: yjsWith({ socket }) },
    });
    expect(getByText("Connected")).toBeTruthy();

    act(() => {
      socket.readyState = WebSocket.CLOSED;
      for (const fn of listeners.get("close") ?? []) fn();
    });
    expect(getByText("Reconnecting")).toBeTruthy();
  });
});
