import type { APIRoute } from "astro";
import { getDatabase, getUser } from "brimjs/server";

// The site's own server code: a like counter per page, kept in a table of the site's own.
// On the server it answers every request; a static build writes the GET answer once, as a file.

async function likes() {
  const db = await getDatabase();
  await db.batch([{ sql: "CREATE TABLE IF NOT EXISTS site_likes (page TEXT PRIMARY KEY, count INTEGER NOT NULL)" }]);
  return db;
}

export const GET: APIRoute = async () => {
  const rows = await (await likes()).query("SELECT page, count FROM site_likes ORDER BY page");
  return Response.json({ likes: Object.fromEntries(rows.map((row) => [row.page, row.count])) });
};

export const POST: APIRoute = async ({ request }) => {
  const { page } = (await request.json().catch(() => ({}))) as { page?: unknown };
  if (typeof page !== "string" || !page.startsWith("/")) {
    return Response.json({ error: "Say which page: { page: '/about' }." }, { status: 422 });
  }
  const db = await likes();
  await db.batch([
    {
      sql: "INSERT INTO site_likes (page, count) VALUES (?, 1) ON CONFLICT (page) DO UPDATE SET count = count + 1",
      args: [page],
    },
  ]);
  const [row] = await db.query("SELECT count FROM site_likes WHERE page = ?", [page]);
  return Response.json({ page, likes: row?.count ?? 0 });
};

// Only someone signed in to the editor may clear the counters.
export const DELETE: APIRoute = async ({ request }) => {
  if (!(await getUser(request))) return Response.json({ error: "Sign in to the editor first." }, { status: 401 });
  await (await likes()).batch([{ sql: "DELETE FROM site_likes" }]);
  return Response.json({ likes: {} });
};
