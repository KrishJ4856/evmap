"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { isTheme, THEME_STORAGE_KEY, type Theme } from "@/lib/theme";

const ThemeContext = createContext<{
  theme: Theme | null;
  toggleTheme: () => void;
} | null>(null);
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme | null>(null);
  const preference = useRef<Theme | null>(null);
  const applyTheme = useCallback((next: Theme) => {
    document.documentElement.dataset.theme = next;
    document.documentElement.style.colorScheme = next;
    setTheme(next);
  }, []);
  useEffect(() => {
    const system = window.matchMedia("(prefers-color-scheme: dark)");
    try {
      const stored = localStorage.getItem(THEME_STORAGE_KEY);
      preference.current = isTheme(stored) ? stored : null;
    } catch {}
    const resolve = () =>
      preference.current ?? (system.matches ? "dark" : "light");
    applyTheme(resolve());
    const systemChanged = () => {
      if (!preference.current) applyTheme(resolve());
    };
    const storageChanged = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY && event.key !== null) return;
      preference.current = isTheme(event.newValue) ? event.newValue : null;
      applyTheme(resolve());
    };
    system.addEventListener("change", systemChanged);
    window.addEventListener("storage", storageChanged);
    return () => {
      system.removeEventListener("change", systemChanged);
      window.removeEventListener("storage", storageChanged);
    };
  }, [applyTheme]);
  const toggleTheme = useCallback(() => {
    const next =
      document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    preference.current = next;
    applyTheme(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {}
  }, [applyTheme]);
  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("ThemeProvider is missing.");
  return context;
}
