// @vitest-environment jsdom
/**
 * useRemoteSync: binds the document socket to a YjsProvider, reports
 * sync state, and closes / reopens the socket around idle sleep.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";

const h = vi.hoisted(() => ({
  socket: null as null | { readyState: number; close: ReturnType<typeof vi.fn>; reconnect: ReturnType<typeof vi.fn> },
  asleep: false,
  providers: [] as { args: unknown[]; destroy: ReturnType<typeof vi.fn> }[],
}));

vi.mock("agents/react", () => ({ useAgent: vi.fn(() => h.socket) }));
vi.mock("~/lib/useIdleSleep", () => ({ useIdleSleep: () => h.asleep }));
vi.mock("~/lib/yjs-provider", () => ({
  YjsProvider: class {
    destroy = vi.fn();
    constructor(...args: unknown[]) {
      h.providers.push({ args, destroy: this.destroy });
    }
  },
}));

const { useRemoteSync } = await import("~/lib/useRemoteSync");
const { useAgent } = await import("agents/react");

function fakeSocket(readyState: number = WebSocket.OPEN) {
  return Object.assign(new EventTarget(), { readyState, close: vi.fn(), reconnect: vi.fn() });
}

const doc = new Y.Doc();
const awareness = new Awareness(doc);

beforeEach(() => {
  h.socket = null;
  h.asleep = false;
  h.providers = [];
  vi.mocked(useAgent).mockClear();
});

describe("useRemoteSync", () => {
  it("does nothing without a socket", () => {
    const { result } = renderHook(() => useRemoteSync(doc, awareness, "abcd1234"));
    expect(result.current).toEqual({ socket: null, synced: false, asleep: false });
    expect(h.providers).toHaveLength(0);
    expect(useAgent).toHaveBeenCalledWith({ agent: "document-agent", name: "abcd1234" });
  });

  it("bridges the socket to the doc and reports sync from the provider", () => {
    h.socket = fakeSocket();
    const { result, unmount } = renderHook(() => useRemoteSync(doc, awareness, "abcd1234"));
    expect(h.providers).toHaveLength(1);
    const [ws, pDoc, pAwareness, setSynced] = h.providers[0].args as [unknown, unknown, unknown, (v: boolean) => void];
    expect([ws, pDoc, pAwareness]).toEqual([h.socket, doc, awareness]);
    expect(result.current.synced).toBe(false);
    act(() => setSynced(true));
    expect(result.current.synced).toBe(true);
    unmount();
    expect(h.providers[0].destroy).toHaveBeenCalled();
  });

  it("closes the socket when asleep and reconnects a closed or closing socket on wake", () => {
    const socket = fakeSocket();
    h.socket = socket;
    h.asleep = true;
    const { rerender, result } = renderHook(() => useRemoteSync(doc, awareness, "abcd1234"));
    expect(result.current.asleep).toBe(true);
    expect(socket.close).toHaveBeenCalledTimes(1);

    socket.readyState = WebSocket.CLOSED;
    h.asleep = false;
    rerender();
    expect(socket.reconnect).toHaveBeenCalledTimes(1);

    h.asleep = true;
    rerender();
    socket.readyState = WebSocket.CLOSING;
    h.asleep = false;
    rerender();
    expect(socket.reconnect).toHaveBeenCalledTimes(2);
  });

  it("leaves an open socket alone when awake", () => {
    const socket = fakeSocket(WebSocket.OPEN);
    h.socket = socket;
    renderHook(() => useRemoteSync(doc, awareness, "abcd1234"));
    expect(socket.close).not.toHaveBeenCalled();
    expect(socket.reconnect).not.toHaveBeenCalled();
  });
});
