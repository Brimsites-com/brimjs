import config from "virtual:brim/config";
import { resolveMedia } from "../config.ts";
import { type PrivateFiles, formFilesDirectory, resolveFormFiles } from "../forms/files.ts";

/**
 * Where this site keeps the files visitors attach to forms, or nothing when it has no private place for them: a
 * static build (no server takes them), or a host that keeps uploads in a storage and named no private one. Forms
 * then leave their file fields out.
 */
export function siteFormFiles(): PrivateFiles | undefined {
  if (config.mode === "static") return undefined;
  return resolveFormFiles({
    storage: config.formFiles.storage,
    mediaInStorage: Boolean(resolveMedia(config.media).storage),
    // Beside the database the server runs with, wherever its host put it.
    directory: formFilesDirectory(config.databaseUrl, process.cwd()),
  });
}
