import { useEffect, useState } from "react";
import { useDocument } from "~/lib/DocumentContext";

type Status = "connected" | "connecting" | "reconnecting" | "sleeping" | "offline";

const DISPLAY: Record<Status, { text: string; dotClass: string; pulse?: boolean }> = {
  connected: { text: "Connected", dotClass: "bg-green-500" },
  connecting: { text: "Connecting", dotClass: "bg-yellow-500", pulse: true },
  reconnecting: { text: "Reconnecting", dotClass: "bg-yellow-500", pulse: true },
  sleeping: { text: "Sleeping", dotClass: "bg-muted" },
  offline: { text: "Offline", dotClass: "bg-red-500" },
};

export default function ConnectionStatus() {
  const { yjs } = useDocument();
  const { socket, asleep } = yjs;

  const [readyState, setReadyState] = useState<number>(
    socket?.readyState === WebSocket.OPEN ? WebSocket.OPEN : WebSocket.CONNECTING,
  );
  const [online, setOnline] = useState(
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  const [everConnected, setEverConnected] = useState(false);

  useEffect(() => {
    if (!socket) return;

    const onStateChange = () => {
      setReadyState(socket.readyState);
      if (socket.readyState === WebSocket.OPEN) setEverConnected(true);
    };
    onStateChange();
    socket.addEventListener("open", onStateChange);
    socket.addEventListener("close", onStateChange);
    socket.addEventListener("error", onStateChange);
    return () => {
      socket.removeEventListener("open", onStateChange);
      socket.removeEventListener("close", onStateChange);
      socket.removeEventListener("error", onStateChange);
    };
  }, [socket]);

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  let status: Status;
  if (asleep) {
    status = "sleeping";
  } else if (!online) {
    status = "offline";
  } else if (readyState === WebSocket.OPEN) {
    status = "connected";
  } else {
    // CONNECTING, CLOSING, or CLOSED while awake and online: the
    // PartySocket retries with backoff, so all three read as (re)connecting.
    status = everConnected ? "reconnecting" : "connecting";
  }

  const display = DISPLAY[status];

  return (
    <span className="inline-flex items-baseline gap-1.5" title={display.text}>
      <span
        className={`h-2 w-2 rounded-full ${display.dotClass} ${display.pulse ? "animate-pulse" : ""} relative top-[-0.5px]`}
      />
      <span className="text-sm uppercase tracking-wider text-muted">
        {display.text}
      </span>
    </span>
  );
}
