import { useEffect, useRef, useState, type ReactNode } from "react";
import { animate, motion, useInView, useReducedMotion } from "motion/react";

/*
 * Motion primitives. Number figures tween on first reveal (0 → value) and then,
 * on a live poll, from their *previous* value to the new one — so a changed
 * figure counts up in place rather than resetting. A fade/rise reveal wraps
 * panels. Everything collapses to an instant, static result under
 * `prefers-reduced-motion`: no counters, no slide-ins.
 */

const EASE_OUT_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];

/**
 * A figure that tweens to `value`. First time it scrolls into view it counts up
 * from 0; whenever `value` later changes it tweens from the last shown number to
 * the new one (the live-update path). Tabular figures keep it from jittering.
 */
export function CountUp({
  value,
  format,
  className,
  delay = 0,
}: {
  value: number;
  format: (n: number) => string;
  className?: string;
  delay?: number;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const inView = useInView(ref, { once: true, amount: 0.4 });
  const reduce = useReducedMotion();
  const [disp, setDisp] = useState(reduce ? value : 0);
  const shown = useRef(reduce ? value : 0);
  const started = useRef(false);

  useEffect(() => {
    if (!inView) return;
    if (reduce) {
      setDisp(value);
      shown.current = value;
      return;
    }
    const from = started.current ? shown.current : 0;
    const firstRun = !started.current;
    started.current = true;
    if (from === value) {
      setDisp(value);
      return;
    }
    const controls = animate(from, value, {
      duration: firstRun ? 1.1 : 0.7,
      delay: firstRun ? delay : 0,
      ease: EASE_OUT_EXPO,
      onUpdate: (v) => {
        setDisp(v);
        shown.current = v;
      },
    });
    return () => controls.stop();
  }, [inView, reduce, value, delay]);

  return (
    <span ref={ref} className={className}>
      {format(disp)}
    </span>
  );
}

/** Fade + rise a block into view once. No-op under reduced motion. */
export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.15 }}
      transition={{ duration: 0.4, delay, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}
