import { useEffect, useRef, useState } from "react";

export const HIDDEN_SLEEP_MS = 60_000;
export const IDLE_SLEEP_MS = 10 * 60_000;

/**
 * Whether this tab should be asleep — disconnected from the document to
 * stop pinning its Durable Object (see
 * docs/plans/2026-08-31-sleeping-tabs-plan.md).
 *
 * Sleep: the page has been hidden for over a minute, or visible with no
 * pointer/key/scroll activity for ten. Wake: any activity or becoming
 * visible again. Waking is instant — the Yjs doc stays in memory and
 * resyncs on reconnect.
 */
export function useIdleSleep(): boolean {
  const [asleep, setAsleep] = useState(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hiddenTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const armIdleTimer = () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
      idleTimer.current = setTimeout(() => setAsleep(true), IDLE_SLEEP_MS);
    };

    const onActivity = () => {
      setAsleep(false);
      armIdleTimer();
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        if (hiddenTimer.current) clearTimeout(hiddenTimer.current);
        hiddenTimer.current = setTimeout(() => setAsleep(true), HIDDEN_SLEEP_MS);
      } else {
        if (hiddenTimer.current) {
          clearTimeout(hiddenTimer.current);
          hiddenTimer.current = null;
        }
        onActivity();
      }
    };

    // Passive listeners: these fire constantly during normal use and must
    // never affect scrolling/typing performance.
    const opts = { passive: true } as const;
    window.addEventListener("pointerdown", onActivity, opts);
    window.addEventListener("pointermove", onActivity, opts);
    window.addEventListener("keydown", onActivity, opts);
    window.addEventListener("wheel", onActivity, opts);
    document.addEventListener("visibilitychange", onVisibility);

    armIdleTimer();

    return () => {
      window.removeEventListener("pointerdown", onActivity);
      window.removeEventListener("pointermove", onActivity);
      window.removeEventListener("keydown", onActivity);
      window.removeEventListener("wheel", onActivity);
      document.removeEventListener("visibilitychange", onVisibility);
      if (idleTimer.current) clearTimeout(idleTimer.current);
      if (hiddenTimer.current) clearTimeout(hiddenTimer.current);
    };
  }, []);

  return asleep;
}
