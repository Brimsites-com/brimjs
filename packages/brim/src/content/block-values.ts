import type { Database } from "../db/database.ts";
import type { BlockEntry, ContentType } from "./content-types.ts";

/** The id a text saved before its field held blocks takes as the field's one block. */
export const FORMER_TEXT_ID = "text";

/**
 * The blocks of a `blocks` field as saved. A field declared `richtext` before keeps its text as it was saved
 * (`{ blocks: [...] }`): it reads as one text block, so changing a field from `richtext` to `blocks` loses nothing,
 * and the owner can add blocks after it at once. Anything else that is not a list reads as no blocks.
 */
export function blocksOf(value: unknown): BlockEntry[] {
  if (Array.isArray(value)) return value as BlockEntry[];
  if (isRichText(value)) return [{ id: FORMER_TEXT_ID, type: "richtext", value }];
  return [];
}

function isRichText(value: unknown): value is Record<string, unknown> & { blocks: unknown[] } {
  return typeof value === "object" && value !== null && Array.isArray((value as { blocks?: unknown }).blocks);
}

const upgraded = new WeakSet<Database>();

/**
 * Writes the texts of fields that became `blocks` as blocks, in the database itself, once per server: one query per
 * `blocks` field, which finds nothing once they are written. A site that changes an article's body from `richtext`
 * to `blocks` then only deploys; reading them as blocks meanwhile is `blocksOf`'s.
 */
export async function upgradeFieldValues(db: Database, contentTypes: ContentType[]): Promise<void> {
  if (upgraded.has(db)) return;
  upgraded.add(db);
  for (const type of contentTypes) {
    for (const field of type.fields) {
      if (field.type !== "blocks" || !/^[A-Za-z_][\w]*$/.test(field.name)) continue;
      const path = `$.${field.name}`;
      await db
        .query(
          `UPDATE brim_items SET data = json_set(data, ?, json_array(json_object('id', ?, 'type', 'richtext', 'value', json(json_extract(data, ?)))))
           WHERE type = ? AND json_type(data, ?) = 'object' AND json_type(data, ?) = 'array'`,
          [path, FORMER_TEXT_ID, path, type.key, path, `${path}.blocks`],
        )
        .catch((error: unknown) => {
          upgraded.delete(db);
          console.warn(`[brim] The texts of "${type.key}.${field.name}" could not be written as blocks:`, error);
        });
    }
  }
}
