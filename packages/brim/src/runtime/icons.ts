import source from "virtual:brim/icons";
import { IconLibrary } from "../icons/library.ts";

/** The site's icons, as its config names them: Brim's own set and the packs added to it. */
export const icons = new IconLibrary(source.options, source.packs);
