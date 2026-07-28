import { useEffect, useMemo, useRef, useState } from "react";
import { rampValue } from "@/palette";
import type { MemorySection } from "@/metrics";

/*
 * The memory knowledge graph — the one showpiece allowed to be bespoke. A real
 * node-link graph laid out with a small deterministic Fruchterman-Reingold
 * simulation (no d3-force dependency): hairline ink edges, labels only on the
 * connected nodes so it never turns to noise.
 *
 * Colour here encodes MAGNITUDE, not identity — link count runs up the one-hue
 * `--seq-*` ramp, so hubs sit dark and leaves sit pale, doubling the radius
 * channel that already reads degree. A node-link graph is an all-pairs form
 * (any two nodes can end up neighbours), where a categorical palette could not
 * be validated past three series — a sequential ramp is the honest encoding.
 */

const VW = 640;
const VH = 460;
const PAD = 44;

// mulberry32 — a tiny deterministic PRNG so the layout is stable across renders
// (Math.random would reshuffle the graph on every poll).
function prng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type P = { x: number; y: number; name: string; type: string; degree: number };

function layout(mem: MemorySection): { nodes: P[]; edges: [number, number][] } {
  const index = new Map(mem.nodes.map((n, i) => [n.name, i]));
  const rand = prng(1337);
  const n = mem.nodes.length;
  const nodes: P[] = mem.nodes.map((node) => ({
    x: PAD + rand() * (VW - 2 * PAD),
    y: PAD + rand() * (VH - 2 * PAD),
    name: node.name,
    type: node.type,
    degree: node.degree,
  }));
  const edges: [number, number][] = [];
  for (const e of mem.edges) {
    const a = index.get(e.from);
    const b = index.get(e.to);
    if (a !== undefined && b !== undefined) edges.push([a, b]);
  }

  const area = (VW - 2 * PAD) * (VH - 2 * PAD);
  const k = Math.sqrt(area / Math.max(n, 1)) * 0.72;
  let temp = (VW - 2 * PAD) / 8;
  const iters = 320;

  for (let it = 0; it < iters; it++) {
    const disp = nodes.map(() => ({ x: 0, y: 0 }));
    // Repulsion between every pair.
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = nodes[i].x - nodes[j].x;
        let dy = nodes[i].y - nodes[j].y;
        let dist = Math.hypot(dx, dy) || 0.01;
        if (dist < 0.01) {
          dx = (rand() - 0.5) * 0.1;
          dy = (rand() - 0.5) * 0.1;
          dist = 0.01;
        }
        const rep = (k * k) / dist;
        disp[i].x += (dx / dist) * rep;
        disp[i].y += (dy / dist) * rep;
        disp[j].x -= (dx / dist) * rep;
        disp[j].y -= (dy / dist) * rep;
      }
    }
    // Attraction along edges.
    for (const [a, b] of edges) {
      const dx = nodes[a].x - nodes[b].x;
      const dy = nodes[a].y - nodes[b].y;
      const dist = Math.hypot(dx, dy) || 0.01;
      const att = (dist * dist) / k;
      const fx = (dx / dist) * att;
      const fy = (dy / dist) * att;
      disp[a].x -= fx;
      disp[a].y -= fy;
      disp[b].x += fx;
      disp[b].y += fy;
    }
    // Gentle pull to centre keeps orphans from drifting to the edges.
    for (let i = 0; i < n; i++) {
      disp[i].x += (VW / 2 - nodes[i].x) * 0.012;
      disp[i].y += (VH / 2 - nodes[i].y) * 0.012;
    }
    for (let i = 0; i < n; i++) {
      const d = Math.hypot(disp[i].x, disp[i].y) || 0.01;
      nodes[i].x += (disp[i].x / d) * Math.min(d, temp);
      nodes[i].y += (disp[i].y / d) * Math.min(d, temp);
      nodes[i].x = Math.max(PAD, Math.min(VW - PAD, nodes[i].x));
      nodes[i].y = Math.max(PAD, Math.min(VH - PAD, nodes[i].y));
    }
    temp *= 0.975;
  }
  return { nodes, edges };
}

export function MemoryGraph({ mem }: { mem: MemorySection }) {
  const { nodes, edges } = useMemo(() => layout(mem), [mem]);
  const [active, setActive] = useState<number | null>(null);
  const radius = (deg: number) => 4 + Math.sqrt(deg) * 3.2;
  const maxDegree = Math.max(1, ...nodes.map((n) => n.degree));

  // The graph draws in a fixed 640-unit viewBox scaled to fit its column, so on a
  // phone the whole coordinate space — labels included — shrinks to ~half size and
  // a 10px label lands near 5px. Measure the rendered width and counter-scale the
  // label so it holds ~11px on screen at every width, and on a narrow plane show
  // labels only for the hubs so the smaller canvas doesn't turn to overlap.
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [rendered, setRendered] = useState(VW);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const cw = entries[0]?.contentRect.width ?? 0;
      if (cw > 0) setRendered(cw);
    });
    ro.observe(el);
    setRendered(el.getBoundingClientRect().width || VW);
    return () => ro.disconnect();
  }, []);
  const scale = rendered > 0 ? VW / rendered : 1; // >1 when the viewBox is shrunk
  const labelPx = Math.min(22, Math.max(10, Math.round(11 * scale)));
  const labelFloor = scale > 1.35 ? 5 : 3; // narrower plane → hubs only

  const neighbors = useMemo(() => {
    const s = new Set<number>();
    if (active === null) return s;
    for (const [a, b] of edges) {
      if (a === active) s.add(b);
      if (b === active) s.add(a);
    }
    return s;
  }, [active, edges]);

  return (
    <div className="flex flex-col gap-3" ref={wrapRef}>
    <svg
      viewBox={`0 0 ${VW} ${VH}`}
      className="block h-auto w-full"
      role="img"
      aria-label={`Memory knowledge graph: ${mem.nodeCount} nodes, ${mem.edgeCount} edges`}
    >
      <g>
        {edges.map(([a, b], i) => {
          const lit = active === null || a === active || b === active;
          return (
            <line
              key={i}
              x1={nodes[a].x}
              y1={nodes[a].y}
              x2={nodes[b].x}
              y2={nodes[b].y}
              stroke="var(--ink)"
              strokeWidth={1}
              strokeOpacity={lit ? 0.32 : 0.08}
            />
          );
        })}
      </g>
      <g>
        {nodes.map((node, i) => {
          const lit = active === null || i === active || neighbors.has(i);
          const showLabel = node.degree >= labelFloor || i === active || neighbors.has(i);
          const r = radius(node.degree);
          return (
            <g
              key={node.name}
              opacity={lit ? 1 : 0.28}
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(null)}
              style={{ cursor: "default", transition: "opacity 180ms ease-out" }}
            >
              <circle
                cx={node.x}
                cy={node.y}
                r={r}
                fill={node.degree > 0 ? rampValue(node.degree, maxDegree) : "var(--surface)"}
                stroke={node.degree > 0 ? "var(--surface)" : "var(--ink-soft)"}
                strokeWidth={node.degree > 0 ? 2 : 1.5}
              />
              {showLabel ? (
                <text
                  x={node.x}
                  y={node.y - r - 4}
                  textAnchor="middle"
                  fontSize={labelPx}
                  fill="var(--foreground)"
                  className="pointer-events-none"
                >
                  {node.name}
                </text>
              ) : null}
            </g>
          );
        })}
      </g>
    </svg>
      <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
        <span className="label-caps">Links</span>
        <span className="tabular-nums">0</span>
        <span className="flex" style={{ gap: 2 }}>
          {[1, 2, 3, 4, 5].map((step) => (
            <span
              key={step}
              aria-hidden
              className="inline-block size-2.5 rounded-[2px]"
              style={{ background: `var(--seq-${step})` }}
            />
          ))}
        </span>
        <span className="tabular-nums">{maxDegree}</span>
      </div>
    </div>
  );
}
