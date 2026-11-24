import type { Database } from "../db/database.ts";
import { siteScope, typeScope } from "./ids.ts";

const adopted = new WeakSet<Database>();

/**
 * A site that turns languages on keeps what its owner saved before. Without languages the site's shared content
 * (navbar, footer, `scope="site"` texts, Site Settings) is kept as `site` and a template's changes as
 * `type:<key>`; with languages each language has its own, `site:<lang>` and `type:<key>:<lang>`. What was saved
 * before becomes the default language's, once per server, in the database itself: the two updates find nothing
 * once it is done, and a language that already has its own value keeps it. Unsaved changes (drafts) move too.
 */
export async function adoptLanguageScopes(db: Database, defaultLocale: string): Promise<void> {
  if (adopted.has(db)) return;
  adopted.add(db);
  const site = siteScope(defaultLocale);
  const suffix = typeScope("", defaultLocale).slice("type:".length);
  try {
    await db.batch([
      { sql: "UPDATE OR IGNORE brim_nodes SET scope = ? WHERE scope = 'site'", args: [site] },
      {
        sql: "UPDATE OR IGNORE brim_nodes SET scope = scope || ? WHERE scope LIKE 'type:%' AND scope NOT LIKE 'type:%:%'",
        args: [suffix],
      },
      // A drafted element is keyed `<scope>\n<nodeId>`.
      {
        sql: "UPDATE OR IGNORE brim_drafts SET key = ? || substr(key, 5) WHERE target = 'node' AND key LIKE 'site' || char(10) || '%'",
        args: [site],
      },
      {
        sql: `UPDATE OR IGNORE brim_drafts SET key = substr(key, 1, instr(key, char(10)) - 1) || ? || substr(key, instr(key, char(10)))
              WHERE target = 'node' AND key LIKE 'type:%' AND substr(key, 1, instr(key, char(10)) - 1) NOT LIKE 'type:%:%'`,
        args: [suffix],
      },
    ]);
  } catch (error) {
    adopted.delete(db);
    throw error;
  }
}
