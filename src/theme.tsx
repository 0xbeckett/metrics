import { createContext, useCallback, useContext, useLayoutEffect, useState, type ReactNode } from "react";
import { refreshDitherSeeds } from "@/components/dither-kit/palette";

/*
 * One theme source of truth. Owns the `.dark` class, persistence, and the
 * dither-kit seed cache — flipping the theme drops the cache so the canvas
 * repaints from the new `--dk-*` tokens. Consumers key their dither charts on
 * `dark` (via {@link useThemeKey}) so those canvases remount and repaint.
 */
type ThemeCtx = { dark: boolean; toggle: () => void };
const Ctx = createContext<ThemeCtx>({ dark: false, toggle: () => {} });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));

  useLayoutEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("bkt-theme", dark ? "dark" : "light");
    refreshDitherSeeds();
  }, [dark]);

  const toggle = useCallback(() => setDark((d) => !d), []);
  return <Ctx.Provider value={{ dark, toggle }}>{children}</Ctx.Provider>;
}

export const useTheme = () => useContext(Ctx);

/** A stable string that changes with the theme — use as a React `key` to force
 *  a canvas-backed chart to remount and repaint after a token flip. */
export function useThemeKey(): string {
  return useContext(Ctx).dark ? "dark" : "light";
}
