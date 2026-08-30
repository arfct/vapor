import { useState, useEffect, useCallback } from "react";

export type Theme = "light" | "dark" | "auto";

const STORAGE_KEY = "vapor-theme";

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>("auto");

  // Read stored theme after hydration to avoid server/client mismatch
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
    if (stored && stored !== theme) {
      setThemeState(stored); // eslint-disable-line react-hooks/set-state-in-effect
      document.documentElement.setAttribute("data-theme", stored);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    localStorage.setItem(STORAGE_KEY, t);
    document.documentElement.setAttribute("data-theme", t);
  }, []);

  return { theme, setTheme };
}
