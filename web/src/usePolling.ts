import { useEffect, useRef } from 'react';

// Runs callback every intervalMs; pass null to stop. The ref keeps the latest callback
// without restarting the timer on every render.
export function usePolling(callback: () => void, intervalMs: number | null): void {
  const saved = useRef(callback);
  saved.current = callback;

  useEffect(() => {
    if (intervalMs === null) {
      return;
    }
    const id = setInterval(() => saved.current(), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
}
