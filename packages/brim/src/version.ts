import manifest from "../package.json" with { type: "json" };

/** The version of brimjs that runs, as published. */
export const VERSION: string = manifest.version;
