import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import type { IconPack, IconsOptions } from "./library.ts";

/**
 * Where each pack of the options is: packs named by package or path become the JSON file to read, packs written
 * in the config stay as they are. A pack that cannot be found stops the site from starting, with the reason.
 */
export function iconPackSources(options: IconsOptions | undefined, projectRoot: string): (string | IconPack)[] {
  const fromSite = createRequire(join(projectRoot, "package.json"));
  return (options?.packs ?? []).map((pack) => {
    if (typeof pack !== "string") return pack;
    if (pack.startsWith(".") || isAbsolute(pack)) return resolve(projectRoot, pack);
    try {
      return fromSite.resolve(pack.endsWith(".json") ? pack : `${pack}/icons.json`);
    } catch {
      throw new Error(`The icon pack "${pack}" was not found. Install it (npm install ${pack}) or fix its name.`);
    }
  });
}

/** The packs themselves, read from their files. */
export function loadIconPacks(sources: (string | IconPack)[]): IconPack[] {
  return sources.map((source) => {
    if (typeof source !== "string") return source;
    try {
      const pack = JSON.parse(readFileSync(source, "utf8")) as IconPack;
      const name = packName(source);
      return name && !pack.name ? { ...pack, name } : pack;
    } catch (error) {
      throw new Error(`The icon pack at ${source} could not be read: ${(error as Error).message}`);
    }
  });
}

/** An `@iconify-json/*` package keeps its pack's name in `info.json`, next to `icons.json`. */
function packName(file: string): string | undefined {
  const info = join(dirname(file), "info.json");
  if (basename(file) !== "icons.json" || !existsSync(info)) return undefined;
  try {
    const { name } = JSON.parse(readFileSync(info, "utf8")) as { name?: unknown };
    return typeof name === "string" && name !== "" ? name : undefined;
  } catch {
    return undefined;
  }
}

/** A module that hands the packs to the site's pages and server: files are imported, so a build carries them. */
export function iconsModule(options: IconsOptions | undefined, sources: (string | IconPack)[]): string {
  const imports = sources.flatMap((source, index) =>
    typeof source === "string" ? [`import pack${index} from ${JSON.stringify(source)};`] : [],
  );
  const packs = sources.map((source, index) => {
    if (typeof source !== "string") return JSON.stringify(source);
    const name = packName(source);
    return name ? `{ name: ${JSON.stringify(name)}, ...pack${index} }` : `pack${index}`;
  });
  return [
    ...imports,
    `export default { options: ${JSON.stringify({ builtIn: options?.builtIn ?? true })}, packs: [${packs.join(", ")}] };`,
  ].join("\n");
}
