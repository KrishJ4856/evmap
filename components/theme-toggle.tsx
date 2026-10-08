"use client";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/components/theme-provider";

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const label = theme === "dark" ? "Dark mode" : "Light mode";
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="theme-toggle"
      aria-label={`${label}. Switch theme`}
      title="Switch theme"
      disabled={theme === null}
      onClick={toggleTheme}
    >
      {theme === "dark" ? (
        <Moon aria-hidden="true" />
      ) : (
        <Sun aria-hidden="true" />
      )}
    </Button>
  );
}
