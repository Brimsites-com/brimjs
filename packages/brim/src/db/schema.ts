import type { Database } from "./database.ts";

/** Append only: a released migration is never edited. */
const MIGRATIONS: string[][] = [
  [
    `CREATE TABLE brim_nodes (
      scope TEXT NOT NULL,
      node_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (scope, node_id)
    ) WITHOUT ROWID`,
    `CREATE TABLE brim_pages (
      path TEXT PRIMARY KEY,
      visibility TEXT NOT NULL CHECK (visibility IN ('private', 'published')),
      updated_at TEXT NOT NULL
    ) WITHOUT ROWID`,
  ],
  [
    `CREATE TABLE brim_users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('owner', 'editor')),
      created_at TEXT NOT NULL
    ) WITHOUT ROWID`,
    `CREATE TABLE brim_sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    ) WITHOUT ROWID`,
    `CREATE TABLE brim_rate_limits (
      key TEXT PRIMARY KEY,
      window_start INTEGER NOT NULL,
      count INTEGER NOT NULL
    ) WITHOUT ROWID`,
  ],
  [
    `ALTER TABLE brim_pages ADD COLUMN seo TEXT NOT NULL DEFAULT '{}'`,
    `CREATE TABLE brim_items (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      slug TEXT NOT NULL,
      title TEXT NOT NULL,
      visibility TEXT NOT NULL CHECK (visibility IN ('private', 'published')),
      data TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (type, slug)
    ) WITHOUT ROWID`,
  ],
  [
    `CREATE TABLE brim_media (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      name TEXT NOT NULL,
      mime TEXT NOT NULL,
      size INTEGER NOT NULL,
      created_at TEXT NOT NULL
    ) WITHOUT ROWID`,
  ],
  [
    `CREATE TABLE brim_form_responses (
      id TEXT PRIMARY KEY,
      form TEXT NOT NULL,
      title TEXT NOT NULL,
      answers TEXT NOT NULL,
      created_at TEXT NOT NULL
    ) WITHOUT ROWID`,
  ],
  [
    `CREATE TABLE brim_tokens (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_used_at TEXT,
      UNIQUE (user_id, name)
    ) WITHOUT ROWID`,
  ],
  [
    // Pages the owner adds from a template; pages written in code keep both empty.
    `ALTER TABLE brim_pages ADD COLUMN template TEXT`,
    `ALTER TABLE brim_pages ADD COLUMN title TEXT`,
  ],
  [`ALTER TABLE brim_media ADD COLUMN folder TEXT NOT NULL DEFAULT ''`],
  [
    // Items in languages: "" is the site's default language (and every item of a site with one language);
    // a translation points at the item it translates. The same address may be used once per language.
    `CREATE TABLE brim_items_v10 (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      locale TEXT NOT NULL DEFAULT '',
      translation_of TEXT,
      slug TEXT NOT NULL,
      title TEXT NOT NULL,
      visibility TEXT NOT NULL CHECK (visibility IN ('private', 'published')),
      data TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (type, locale, slug)
    ) WITHOUT ROWID`,
    `INSERT INTO brim_items_v10 (id, type, locale, translation_of, slug, title, visibility, data, created_at, updated_at)
      SELECT id, type, '', NULL, slug, title, visibility, data, created_at, updated_at FROM brim_items`,
    `DROP TABLE brim_items`,
    `ALTER TABLE brim_items_v10 RENAME TO brim_items`,
  ],
  [
    // A third role, "writer"; and what content was before each change, so a change can be taken back.
    `CREATE TABLE brim_users_v11 (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'writer')),
      created_at TEXT NOT NULL
    ) WITHOUT ROWID`,
    `INSERT INTO brim_users_v11 (id, email, password_hash, role, created_at)
      SELECT id, email, password_hash, role, created_at FROM brim_users`,
    `DROP TABLE brim_users`,
    `ALTER TABLE brim_users_v11 RENAME TO brim_users`,
    `CREATE TABLE brim_history (
      id TEXT PRIMARY KEY,
      target TEXT NOT NULL CHECK (target IN ('node', 'item', 'page')),
      key TEXT NOT NULL,
      action TEXT NOT NULL CHECK (action IN ('changed', 'reset', 'deleted')),
      page TEXT NOT NULL,
      title TEXT NOT NULL,
      before TEXT,
      user_email TEXT NOT NULL,
      created_at TEXT NOT NULL
    ) WITHOUT ROWID`,
    `CREATE INDEX brim_history_recent ON brim_history (created_at)`,
    `CREATE INDEX brim_history_key ON brim_history (target, key, created_at)`,
  ],
  [
    // Each item's place among the items of its type, for the types the owner puts in order by hand. Items that
    // exist keep the order they were added in.
    `ALTER TABLE brim_items ADD COLUMN position INTEGER NOT NULL DEFAULT 0`,
    `UPDATE brim_items SET position = (
      SELECT COUNT(*) FROM brim_items AS earlier
      WHERE earlier.type = brim_items.type AND earlier.locale = brim_items.locale
        AND (earlier.created_at < brim_items.created_at
          OR (earlier.created_at = brim_items.created_at AND earlier.id < brim_items.id))
    ) + 1`,
  ],
  [
    // An image's size, read from its file when it is uploaded, so pages give each <img> its width and height and the
    // browser keeps its place before it arrives. Images uploaded before are measured later (see image-sizes.ts).
    `ALTER TABLE brim_media ADD COLUMN width INTEGER`,
    `ALTER TABLE brim_media ADD COLUMN height INTEGER`,
  ],
  [
    // Changes made in the editor that visitors do not see until someone saves them.
    `CREATE TABLE brim_drafts (
      target TEXT NOT NULL CHECK (target IN ('node', 'item', 'seo')),
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      page TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (target, key)
    ) WITHOUT ROWID`,
  ],
  [
    // The files a visitor attached to a form message: what they are (id, field, name, type, size). Their bytes are
    // kept outside the database, in a private place.
    `ALTER TABLE brim_form_responses ADD COLUMN files TEXT NOT NULL DEFAULT '[]'`,
  ],
  [
    // AI apps (ChatGPT, Claude) connected to the site's MCP with OAuth: the apps that registered themselves, the
    // one-time codes of a sign-in in progress, and each connection a user allowed, with its current tokens' hashes.
    `CREATE TABLE brim_oauth_clients (
      client_id TEXT PRIMARY KEY,
      secret_hash TEXT,
      name TEXT NOT NULL,
      redirect_uris TEXT NOT NULL,
      created_at TEXT NOT NULL
    ) WITHOUT ROWID`,
    `CREATE TABLE brim_oauth_codes (
      code_hash TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      redirect_uri TEXT NOT NULL,
      challenge TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    ) WITHOUT ROWID`,
    `CREATE TABLE brim_oauth_grants (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      access_hash TEXT NOT NULL UNIQUE,
      access_expires_at INTEGER NOT NULL,
      refresh_hash TEXT NOT NULL UNIQUE,
      previous_refresh_hash TEXT,
      rotated_at INTEGER,
      created_at TEXT NOT NULL,
      last_used_at TEXT
    ) WITHOUT ROWID`,
    `CREATE INDEX brim_oauth_grants_previous ON brim_oauth_grants (previous_refresh_hash)`,
    `CREATE INDEX brim_oauth_grants_user ON brim_oauth_grants (user_id)`,
  ],
];

/** How many migrations this brimjs knows; a database is at this version once `migrate` ran. */
export const SCHEMA_VERSION = MIGRATIONS.length;

export async function migrate(db: Database): Promise<void> {
  await db.query("CREATE TABLE IF NOT EXISTS brim_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID");
  const rows = await db.query("SELECT value FROM brim_meta WHERE key = 'schema_version'");
  const current = Number(rows[0]?.value ?? 0);

  for (let version = current; version < MIGRATIONS.length; version++) {
    const statements = MIGRATIONS[version] ?? [];
    await db.batch([
      ...statements.map((sql) => ({ sql })),
      {
        sql: "INSERT INTO brim_meta (key, value) VALUES ('schema_version', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        args: [String(version + 1)],
      },
    ]);
  }
}
