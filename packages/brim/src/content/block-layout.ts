/**
 * How a block sits in a `blocks` field, where no code of the site places it: how wide (`narrow`, `content`, `wide`,
 * `full`, whose widths the site sets with `--brim-block-narrow`, `--brim-block-content` and `--brim-block-wide`),
 * when narrower than its place, to which side, and how much space is above it, in steps of the site's rhythm. The same two choices for every kind of block; a block the site's code
 * places itself has neither, since the code decides.
 */
export const BLOCK_WIDTHS = ["narrow", "content", "wide", "full"] as const;
export const BLOCK_ALIGNS = ["left", "center", "right"] as const;
/** The space above a block, in steps of the site's rhythm (`--brim-block-gap`): 0, ½, 1 or 2 times it. */
export const BLOCK_SPACES = ["none", "small", "normal", "large"] as const;

export type BlockWidth = (typeof BLOCK_WIDTHS)[number];
export type BlockAlign = (typeof BLOCK_ALIGNS)[number];
export type BlockSpace = (typeof BLOCK_SPACES)[number];

export interface BlockLayout {
  width: BlockWidth;
  align: BlockAlign;
  space: BlockSpace;
}

export const DEFAULT_BLOCK_LAYOUT: BlockLayout = { width: "content", align: "center", space: "normal" };

/** How wide each width is drawn by default, for the `sizes` of its pictures; the site's CSS may set others. */
const DRAWN: Record<BlockWidth, string> = {
  narrow: "(max-width: 480px) 100vw, 480px",
  content: "(max-width: 760px) 100vw, 760px",
  wide: "(max-width: 1200px) 100vw, 1200px",
  full: "100vw",
};

export function blockSizes(width: BlockWidth): string {
  return DRAWN[width];
}

/**
 * A block's layout: the one saved with it, or, for a block saved before blocks had one, what its own settings said
 * (an image's or a video's `size`, a button's `inlineAlignment`), so it keeps looking as it did.
 */
export function layoutOf(type: string, layout: unknown, value: Record<string, unknown> = {}): BlockLayout {
  if (typeof layout === "object" && layout !== null) {
    const { width, align, space } = layout as Record<string, unknown>;
    return {
      width: BLOCK_WIDTHS.includes(width as BlockWidth) ? (width as BlockWidth) : DEFAULT_BLOCK_LAYOUT.width,
      align: BLOCK_ALIGNS.includes(align as BlockAlign) ? (align as BlockAlign) : DEFAULT_BLOCK_LAYOUT.align,
      space: BLOCK_SPACES.includes(space as BlockSpace) ? (space as BlockSpace) : DEFAULT_BLOCK_LAYOUT.space,
    };
  }
  const size = value.size;
  const width: BlockWidth =
    (type === "image" || type === "video" || type === "map") && typeof size === "string"
      ? size === "sm" || size === "md" || size === "custom"
        ? "narrow"
        : size === "lg"
          ? "wide"
          : "content"
      : DEFAULT_BLOCK_LAYOUT.width;
  const alignment = value.inlineAlignment ?? value.objectPosition;
  const align: BlockAlign = BLOCK_ALIGNS.includes(alignment as BlockAlign)
    ? (alignment as BlockAlign)
    : DEFAULT_BLOCK_LAYOUT.align;
  return { width, align, space: DEFAULT_BLOCK_LAYOUT.space };
}
