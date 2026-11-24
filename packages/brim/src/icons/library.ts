import { ICONS } from "../blocks/data/icons.ts";

/**
 * One pack of icons, in the Iconify JSON format that the `@iconify-json/*` packages ship, so any of them can be
 * given as it is. A hand-written pack only needs `prefix` and `icons`; an icon may be just its SVG content.
 */
export interface IconPack {
  /** Short name of the pack, part of every icon's saved name: `prefix:icon`. Letters, digits and dashes. */
  prefix: string;
  /** Shown in the editor above the pack's icons. Defaults to `info.name`, then to the prefix. */
  name?: string;
  info?: { name?: string };
  /** Size of the drawing area of the pack's icons. Defaults to 16, as the Iconify format says. */
  width?: number;
  height?: number;
  /** What goes inside each icon's `<svg>`. Icons that follow the text colour use `currentColor`. */
  icons: Record<string, string | { body: string; width?: number; height?: number }>;
  /** Other names for an icon. Aliases that turn or flip their icon are left out. */
  aliases?: Record<string, { parent: string; rotate?: number; hFlip?: boolean; vFlip?: boolean }>;
}

/** Which icons the editor offers. Without it: Brim's own set. */
export interface IconsOptions {
  /**
   * Brim's own icons: `true` (default) offers all of them, `false` none, a list only the ones named.
   * An icon already placed on a page keeps showing either way.
   */
  builtIn?: boolean | string[];
  /**
   * More packs. Each is an Iconify JSON package (`"@iconify-json/tabler"`), a JSON file of the site
   * (`"./src/icons/brand.json"`), or the pack itself.
   */
  packs?: (string | IconPack)[];
}

/** An icon ready to draw. */
export interface Icon {
  /** What a block saves: the bare name for Brim's own icons, `prefix:name` for a pack's. */
  value: string;
  name: string;
  body: string;
  viewBox: string;
  /** Brim's own icons are outlines drawn with the text colour; a pack's icons carry their own look. */
  outline: boolean;
}

export interface IconSetInfo {
  id: string;
  name: string;
  total: number;
}

export interface IconSearch {
  icons: Icon[];
  /** How many icons match, of which `icons` holds the first ones. */
  total: number;
}

/** The id of Brim's own set. Its icons are saved without a prefix, as they always were. */
export const BUILT_IN_SET = "brim";
const BUILT_IN_VIEW_BOX = "0 0 24 24";
const PREFIX = /^[a-z0-9]+(-[a-z0-9]+)*$/;
/** Enough to show all of Brim's own set at once; a larger pack is narrowed by searching. */
const DEFAULT_LIMIT = 300;
const MAX_LIMIT = 500;

interface IconSet extends IconSetInfo {
  icons: Map<string, Icon>;
}

/** Every icon the site can draw, and the part of them the editor offers. */
export class IconLibrary {
  readonly #sets: IconSet[] = [];
  /** Brim's own icons the editor offers; all of them can still be drawn. */
  readonly #offered: Set<string>;

  constructor(options: IconsOptions = {}, packs: IconPack[] = []) {
    const { builtIn = true } = options;
    const known = Object.keys(ICONS);
    this.#offered = new Set(builtIn === true ? known : builtIn === false ? [] : builtIn.filter((name) => ICONS[name]));
    if (this.#offered.size > 0) {
      this.#sets.push({
        id: BUILT_IN_SET,
        name: "Brim",
        total: this.#offered.size,
        icons: new Map(known.filter((name) => this.#offered.has(name)).map((name) => [name, builtInIcon(name)])),
      });
    }
    for (const pack of packs) this.#sets.push(readPack(pack, this.#sets));
  }

  /** The sets the editor offers, Brim's own first. */
  sets(): IconSetInfo[] {
    return this.#sets.map(({ id, name, total }) => ({ id, name, total }));
  }

  /** Icons of one set whose name contains `query`, in the set's own order. An unknown set has none. */
  search(setId: string, query = "", limit = DEFAULT_LIMIT): IconSearch {
    const set = this.#sets.find((candidate) => candidate.id === setId);
    if (!set) return { icons: [], total: 0 };
    const wanted = query.trim().toLowerCase();
    const matches = [...set.icons.values()].filter((icon) => icon.name.includes(wanted));
    const count = Math.min(Math.max(1, Math.trunc(limit) || DEFAULT_LIMIT), MAX_LIMIT);
    return { icons: matches.slice(0, count), total: matches.length };
  }

  /** The icon a block saved. Brim's own icons are found even when the editor no longer offers them. */
  find(value: unknown): Icon | undefined {
    if (typeof value !== "string") return undefined;
    const split = value.indexOf(":");
    if (split === -1) return ICONS[value] ? builtInIcon(value) : undefined;
    const set = this.#sets.find((candidate) => candidate.id === value.slice(0, split));
    return set?.id === BUILT_IN_SET ? undefined : set?.icons.get(value.slice(split + 1));
  }
}

function builtInIcon(name: string): Icon {
  return { value: name, name, body: ICONS[name] ?? "", viewBox: BUILT_IN_VIEW_BOX, outline: true };
}

function readPack(pack: IconPack, before: IconSet[]): IconSet {
  const prefix = typeof pack?.prefix === "string" ? pack.prefix : "";
  if (!PREFIX.test(prefix) || prefix === BUILT_IN_SET) {
    throw new Error(
      `An icon pack needs a "prefix" of lowercase letters, digits and dashes, other than "${BUILT_IN_SET}". Got: ${JSON.stringify(pack?.prefix)}.`,
    );
  }
  if (before.some((set) => set.id === prefix)) throw new Error(`Two icon packs have the prefix "${prefix}".`);
  if (!pack.icons || typeof pack.icons !== "object") throw new Error(`The icon pack "${prefix}" has no "icons".`);

  const icons = new Map<string, Icon>();
  const add = (name: string, source: string | { body: string; width?: number; height?: number }): void => {
    const { body, width, height } = typeof source === "string" ? { body: source } : source;
    if (typeof body !== "string" || body === "") return;
    const viewBox = `0 0 ${width ?? pack.width ?? 16} ${height ?? pack.height ?? 16}`;
    icons.set(name, { value: `${prefix}:${name}`, name, body, viewBox, outline: false });
  };
  for (const [name, source] of Object.entries(pack.icons)) add(name, source);
  for (const [name, alias] of Object.entries(pack.aliases ?? {})) {
    const parent = pack.icons[alias.parent];
    if (parent && !alias.rotate && !alias.hFlip && !alias.vFlip && !icons.has(name)) add(name, parent);
  }
  return { id: prefix, name: pack.name ?? pack.info?.name ?? prefix, total: icons.size, icons };
}
