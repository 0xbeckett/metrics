import { useEffect, useRef, useState } from "react";
import { fallbackMetrics, fetchMetrics, type Metrics } from "@/metrics";

/*
 * Live data layer. Polls /metrics.json every 15s, diffs the document against the
 * last one, and only swaps state when it actually advances — so unchanged polls
 * cause no re-render, no flash, no relayout. A 1s clock drives the "updated Ns
 * ago" readout, which degrades honestly to a stale state when a fetch fails or
 * the document stops advancing.
 *
 * The two live at different cadences on purpose, in two hooks. `useLiveMetrics`
 * only re-renders when the document actually advances; the per-second tick lives
 * in `useDataAge`, called by the freshness readout alone. Keeping them in one
 * hook re-rendered the whole page every second, which re-created the chart
 * series arrays and made every dither canvas replay its entrance animation.
 */

const POLL_MS = 15_000;
// If the document hasn't advanced within this window, we say so rather than
// implying freshness. Matches the harvester's own refresh cadence with slack.
const STALE_SECONDS = 150;

const signature = (m: Metrics) => `${m.refreshed_at ?? ""}|${m.source_generated_at ?? ""}`;

export type LiveState = {
  metrics: Metrics;
  /** When the document says it was refreshed, in epoch ms — null if unstamped. */
  refreshedAt: number | null;
  fetchOk: boolean;
};

export type DataAge = {
  ageSeconds: number | null;
  stale: boolean;
};

export function useLiveMetrics(): LiveState {
  const [metrics, setMetrics] = useState<Metrics>(fallbackMetrics);
  const [fetchOk, setFetchOk] = useState(true);
  const sigRef = useRef(signature(fallbackMetrics));

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const next = await fetchMetrics();
        if (!alive) return;
        setFetchOk(true);
        const sig = signature(next);
        if (sig !== sigRef.current) {
          sigRef.current = sig;
          setMetrics(next);
        }
      } catch (error) {
        if (!alive) return;
        setFetchOk(false);
        console.warn("metrics poll failed; holding last document", error);
      }
    };
    void poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const dataTs = metrics.refreshed_at ? Date.parse(metrics.refreshed_at) : NaN;
  const refreshedAt = Number.isFinite(dataTs) ? dataTs : null;

  return { metrics, refreshedAt, fetchOk };
}

/**
 * The 1s freshness clock, owned by whoever renders the readout. Everything this
 * ticks re-renders once a second, so keep it as low in the tree as possible —
 * today that is `LiveIndicator` and nothing else.
 */
export function useDataAge(refreshedAt: number | null, fetchOk: boolean): DataAge {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const ageSeconds = refreshedAt === null ? null : Math.max(0, Math.floor((now - refreshedAt) / 1000));
  const stale = !fetchOk || ageSeconds === null || ageSeconds > STALE_SECONDS;

  return { ageSeconds, stale };
}

/** "updated 12s ago" / "3m ago" / "2h ago" from an age in seconds. */
export function formatAge(seconds: number | null): string {
  if (seconds === null) return "—";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}
