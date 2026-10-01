import { useCallback, useEffect, useState } from "react";

/** How long an armed confirm waits for its second click. */
export const CONFIRM_TIMEOUT_MS = 4000;

/**
 * Two-step confirm for destructive actions: the first click `arm`s it, a
 * second click while `armed` goes ahead. It disarms by itself after
 * `timeoutMs`, and callers `disarm` it on blur, Escape or Cancel. `hold`
 * keeps it armed (and the timer stopped) while the action is running.
 */
export function useArmedConfirm(timeoutMs = CONFIRM_TIMEOUT_MS, hold = false) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed || hold) return;
    const t = window.setTimeout(() => setArmed(false), timeoutMs);
    return () => window.clearTimeout(t);
  }, [armed, hold, timeoutMs]);

  const arm = useCallback(() => setArmed(true), []);
  const disarm = useCallback(() => setArmed(false), []);
  return { armed, arm, disarm };
}
