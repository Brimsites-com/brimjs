import type { ImageFocus } from "./types.ts";

const percent = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100
    ? Math.round(value * 10) / 10
    : undefined;

/** Whether a value is a focus, the middle included: `{ x, y }`, percentages from 0 to 100. */
export function isFocus(value: unknown): value is ImageFocus {
  if (typeof value !== "object" || value === null) return false;
  const { x, y } = value as Record<string, unknown>;
  return percent(x) !== undefined && percent(y) !== undefined;
}

/**
 * A picture's focus as it was saved (`{ x, y }`, percentages), or undefined when there is none, it is not one, or it
 * is the middle: a picture cropped around its middle needs nothing said.
 */
export function readFocus(value: unknown): ImageFocus | undefined {
  if (!isFocus(value)) return undefined;
  const x = percent(value.x) ?? 50;
  const y = percent(value.y) ?? 50;
  return x === 50 && y === 50 ? undefined : { x, y };
}

/**
 * The CSS that anchors a cropped picture at its focus, for an `<img style>`: `object-position:30% 20%`, or undefined
 * for a picture without one. It changes nothing where the site does not crop the picture.
 *
 *   <img {...imageSources(item.data.cover.src)} alt={item.data.cover.alt} style={focusStyle(item.data.cover.focus)} />
 */
export function focusStyle(focus: unknown): string | undefined {
  const point = readFocus(focus);
  return point ? `object-position:${point.x}% ${point.y}%` : undefined;
}
