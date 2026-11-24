import { useEffect, useState } from "react";

/**
 * The editor's appearance: the system's light or dark one, or one the user picked in the ⋯ menu, which this browser
 * remembers. Only the editor's own frame changes: the page being edited keeps the site's look.
 */
export type Theme = "system" | "light" | "dark";

const KEY = "brim-editor-theme";
const darkScheme = matchMedia("(prefers-color-scheme: dark)");
const listeners = new Set<(theme: Theme) => void>();

function stored(): Theme {
  try {
    const value = localStorage.getItem(KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

let current: Theme = stored();

function apply(): void {
  const dark = current === "dark" || (current === "system" && darkScheme.matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}

/** Draws the editor in the remembered appearance, and follows the system while it is the choice. */
export function startTheme(): void {
  apply();
  darkScheme.addEventListener("change", apply);
}

export function setTheme(theme: Theme): void {
  current = theme;
  try {
    if (theme === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, theme);
  } catch {
    // Without storage the choice lasts until the editor is reloaded.
  }
  apply();
  for (const listener of listeners) listener(theme);
}

export function useTheme(): [Theme, (theme: Theme) => void] {
  const [theme, setState] = useState(current);
  useEffect(() => {
    listeners.add(setState);
    return () => void listeners.delete(setState);
  }, []);
  return [theme, setTheme];
}
