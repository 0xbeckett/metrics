import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/*
 * The sticky in-page rail for the one-page dashboard. A scroll-position spy marks
 * the section you are reading; the links jump to it (CSS smooth-scroll, quiet
 * under reduced motion). The rail scrolls horizontally on a phone so it never
 * widens the page, and carries the live indicator + theme toggle so both stay a
 * thumb away no matter how far you have scrolled. The active mark is a filled
 * secondary pill, never the accent — the accent stays reserved for live/delta.
 */

export type NavSection = { id: string; label: string };

/**
 * Which section id is currently under the sticky rail. Reads scroll position
 * rather than IntersectionObserver so the "current" section is unambiguous even
 * with tall panels, and pins to the last section once the page is scrolled to
 * the bottom (so short trailing sections still light up).
 *
 * The scroll handler fires on every frame of a scroll, so it only calls `setActive`
 * when the section genuinely changed — this hook sits at the root, and setting
 * state per scroll event would re-render (and re-animate) the whole page while
 * the reader is simply moving down it.
 */
export function useScrollSpy(ids: string[], offset = 96): string {
  const key = ids.join(",");
  const [active, setActive] = useState(ids[0] ?? "");
  const activeRef = useRef(active);

  useEffect(() => {
    const commit = (next: string) => {
      if (next === activeRef.current) return;
      activeRef.current = next;
      setActive(next);
    };
    const compute = () => {
      const atBottom =
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      if (atBottom) {
        commit(ids[ids.length - 1] ?? "");
        return;
      }
      let current = ids[0] ?? "";
      for (const id of ids) {
        const el = document.getElementById(id);
        if (!el) continue;
        if (el.getBoundingClientRect().top - offset <= 1) current = id;
      }
      commit(current);
    };
    compute();
    window.addEventListener("scroll", compute, { passive: true });
    window.addEventListener("resize", compute);
    return () => {
      window.removeEventListener("scroll", compute);
      window.removeEventListener("resize", compute);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, offset]);

  return active;
}

export function SectionNav({
  sections,
  active,
  controls,
}: {
  sections: NavSection[];
  active: string;
  controls?: ReactNode;
}) {
  // The rail is wider than a phone, so it scrolls. Keep the current section's
  // tab in view as the reader moves down the page — otherwise "The loop" and
  // "Runtime" sit off the right edge and the active mark is never seen.
  const navRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const el = navRef.current?.querySelector<HTMLElement>(`a[data-id="${active}"]`);
    el?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [active]);

  return (
    <div className="sticky top-0 z-40 -mx-4 mb-8 border-b border-border bg-background/85 px-4 backdrop-blur-md sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
      <div className="flex items-center justify-between gap-3 py-2 sm:py-2.5">
        {/* A right-edge fade on the phone marks the rail as scrollable; it lifts
            at sm where every tab fits without scrolling. */}
        <nav
          ref={navRef}
          aria-label="Dashboard sections"
          className="scrollbar-none flex min-w-0 flex-1 gap-1 overflow-x-auto mask-r-from-88% mask-r-to-100% sm:mask-none"
        >
          {sections.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              data-id={s.id}
              aria-current={active === s.id ? "true" : undefined}
              className={cn(
                "flex min-h-11 shrink-0 items-center rounded-md px-3 text-sm font-medium tabular-nums transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0 sm:py-2 sm:text-[13px]",
                active === s.id
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {s.label}
            </a>
          ))}
        </nav>
        {controls ? <div className="flex shrink-0 items-center gap-2">{controls}</div> : null}
      </div>
    </div>
  );
}
