/**
 * Named colors BrimCMS offered in color settings. A site sets them as `--brim-theme-<name>`;
 * the values here are what shows until it does.
 */
export const THEME_COLOR_DEFAULTS: Record<string, string> = {
  background: "#ffffff",
  light1: "#f4f4f5",
  light2: "#e4e4e7",
  accent: "#2563eb",
  primary: "#1e1e1d",
  dark1: "#3f3f46",
  dark2: "#0a0a0a",
};

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/**
 * Turns a color setting into CSS: a theme color by name, a custom hex color, or the surrounding
 * text color for `auto` and anything unexpected, so a saved value can never inject other CSS.
 */
export function themeColor(value: unknown): string {
  if (typeof value !== "string") return "currentColor";
  if (Object.hasOwn(THEME_COLOR_DEFAULTS, value)) return `var(--brim-theme-${value}, ${THEME_COLOR_DEFAULTS[value]})`;
  return HEX_COLOR.test(value) ? value : "currentColor";
}

/** BrimCMS stored some texts as HTML. Here they are shown as plain text, so nothing saved can run as markup. */
export function plainText(value: unknown): string {
  return typeof value === "string"
    ? value
        .replace(/<\/(p|div|h[1-6]|li)>/gi, "\n")
        .replace(/<[^>]*>/g, "")
        .trim()
    : "";
}
