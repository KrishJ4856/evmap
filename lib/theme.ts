export type Theme = "light" | "dark";
export const THEME_STORAGE_KEY = "evmap-theme";
export function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark";
}

// Run before paint; saved preferences and system dark mode never flash light on reload.
export const THEME_INIT_SCRIPT = `(function(){var t;try{t=localStorage.getItem("${THEME_STORAGE_KEY}")}catch(e){}if(t!=="light"&&t!=="dark")t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";document.documentElement.dataset.theme=t;document.documentElement.style.colorScheme=t})()`;
