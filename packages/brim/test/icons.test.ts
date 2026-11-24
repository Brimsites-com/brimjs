import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { Accounts } from "../src/auth/accounts.ts";
import { ItemStore } from "../src/content/items.ts";
import { ContentStore } from "../src/content/store.ts";
import { openDatabase } from "../src/db/libsql.ts";
import { migrate } from "../src/db/schema.ts";
import { HistoryStore } from "../src/content/history.ts";
import { DraftStore } from "../src/content/drafts.ts";
import { FormStore } from "../src/forms/store.ts";
import { IconLibrary, type IconPack } from "../src/icons/library.ts";
import { iconPackSources, iconsModule, loadIconPacks } from "../src/icons/load.ts";
import type { Brim } from "../src/runtime/connect.ts";
import { type AdminHandler, createAdminHandler } from "../src/server/handler.ts";

const ORIGIN = "http://localhost:4321";
const EMAIL = "owner@example.test";
const PASSWORD = "correct horse battery"; // betterleaks:allow
const visitor = { clientAddress: "203.0.113.7" };

/** A pack as the `@iconify-json/*` packages ship it. */
const PACK: IconPack = {
  prefix: "acme",
  info: { name: "Acme Icons" },
  width: 32,
  height: 32,
  icons: {
    rocket: { body: '<path fill="currentColor" d="M1 1h30v30z"/>' },
    "rocket-launch": { body: '<path d="M2 2h4"/>', width: 20, height: 20 },
    moon: '<circle cx="16" cy="16" r="9"/>',
  },
  aliases: { spaceship: { parent: "rocket" }, "rocket-down": { parent: "rocket", vFlip: true } },
};

describe("the site's icons", () => {
  it("offers Brim's own set when nothing is configured", () => {
    const icons = new IconLibrary();
    const [set, ...others] = icons.sets();

    expect(others).toEqual([]);
    expect(set).toMatchObject({ id: "brim", name: "Brim" });
    expect(set?.total).toBeGreaterThan(100);
    expect(icons.find("star")).toMatchObject({ value: "star", viewBox: "0 0 24 24", outline: true });
    expect(icons.find("no-such-icon")).toBeUndefined();
    expect(icons.find(undefined)).toBeUndefined();
  });

  it("offers only the built-in icons the site keeps, and still draws the others", () => {
    const some = new IconLibrary({ builtIn: ["heart", "star", "no-such-icon"] });
    expect(some.sets()).toEqual([{ id: "brim", name: "Brim", total: 2 }]);
    expect(some.search("brim").icons.map((icon) => icon.value)).toEqual(["heart", "star"]);
    // A page that already shows the phone keeps it.
    expect(some.find("phone")).toMatchObject({ value: "phone" });

    const none = new IconLibrary({ builtIn: false }, [PACK]);
    expect(none.sets()).toEqual([{ id: "acme", name: "Acme Icons", total: 4 }]);
    expect(none.search("brim")).toEqual({ icons: [], total: 0 });
    expect(none.find("star")).toMatchObject({ value: "star" });
  });

  it("reads a pack: its name, sizes, plain bodies and simple aliases", () => {
    const icons = new IconLibrary({}, [PACK]);

    expect(icons.sets().map((set) => set.id)).toEqual(["brim", "acme"]);
    expect(icons.find("acme:rocket")).toEqual({
      value: "acme:rocket",
      name: "rocket",
      body: '<path fill="currentColor" d="M1 1h30v30z"/>',
      viewBox: "0 0 32 32",
      outline: false,
    });
    expect(icons.find("acme:rocket-launch")?.viewBox).toBe("0 0 20 20");
    expect(icons.find("acme:moon")?.body).toBe('<circle cx="16" cy="16" r="9"/>');
    expect(icons.find("acme:spaceship")?.body).toBe(icons.find("acme:rocket")?.body);
    // A flipped alias would be drawn wrong, so it is not offered.
    expect(icons.find("acme:rocket-down")).toBeUndefined();
    expect(icons.find("other:rocket")).toBeUndefined();
    expect(icons.find("brim:star")).toBeUndefined();
  });

  it("searches a set by name and hands back the first matches with the count", () => {
    const icons = new IconLibrary({}, [PACK]);

    expect(icons.search("acme", " ROCK ").icons.map((icon) => icon.name)).toEqual(["rocket", "rocket-launch"]);
    expect(icons.search("acme", "", 1)).toMatchObject({ icons: [{ name: "rocket" }], total: 4 });
    expect(icons.search("acme", "zzz")).toEqual({ icons: [], total: 0 });
  });

  it("refuses a pack it could not tell apart", () => {
    expect(() => new IconLibrary({}, [{ ...PACK, prefix: "Acme Icons" }])).toThrow(/prefix/);
    expect(() => new IconLibrary({}, [{ ...PACK, prefix: "brim" }])).toThrow(/prefix/);
    expect(() => new IconLibrary({}, [PACK, PACK])).toThrow(/Two icon packs/);
    expect(() => new IconLibrary({}, [{ prefix: "empty" } as IconPack])).toThrow(/no "icons"/);
  });
});

describe("icon packs named in the config", () => {
  const root = mkdtempSync(join(tmpdir(), "brim-icons-"));
  writeFileSync(join(root, "package.json"), "{}");
  writeFileSync(join(root, "brand.json"), JSON.stringify(PACK));

  it("finds a pack by its path in the site and reads it", () => {
    const sources = iconPackSources({ packs: ["./brand.json", { prefix: "inline", icons: { a: "<path/>" } }] }, root);

    expect(sources[0]).toBe(join(root, "brand.json"));
    expect(loadIconPacks(sources).map((pack) => pack.prefix)).toEqual(["acme", "inline"]);
  });

  it("finds an installed Iconify package and takes its name from the package", () => {
    const folder = join(root, "node_modules", "@iconify-json", "acme");
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "package.json"), JSON.stringify({ name: "@iconify-json/acme", version: "1.0.0" }));
    writeFileSync(
      join(folder, "icons.json"),
      JSON.stringify({ prefix: "acme", icons: { dot: { body: "<circle/>" } } }),
    );
    writeFileSync(join(folder, "info.json"), JSON.stringify({ name: "Acme Package" }));

    const sources = iconPackSources({ packs: ["@iconify-json/acme"] }, root);
    const icons = new IconLibrary({ builtIn: false }, loadIconPacks(sources));

    expect(icons.sets()).toEqual([{ id: "acme", name: "Acme Package", total: 1 }]);
    // Without a size of its own, an icon has the 16 by 16 area the format says.
    expect(icons.find("acme:dot")?.viewBox).toBe("0 0 16 16");
    expect(iconsModule({}, sources)).toContain('{ name: "Acme Package", ...pack0 }');
  });

  it("says which pack is missing", () => {
    expect(() => iconPackSources({ packs: ["@iconify-json/not-installed"] }, root)).toThrow(
      /"@iconify-json\/not-installed" was not found/,
    );
    expect(() => loadIconPacks([join(root, "missing.json")])).toThrow(/could not be read/);
  });

  it("writes the module the built site reads: files imported, written packs as they are", () => {
    const code = iconsModule({ builtIn: ["star"] }, ["/site/brand.json", { prefix: "inline", icons: {} }]);

    expect(code).toContain('import pack0 from "/site/brand.json";');
    expect(code).toContain('options: {"builtIn":["star"]}');
    expect(code).toContain('packs: [pack0, {"prefix":"inline","icons":{}}]');
  });
});

describe("the editor's icon routes", () => {
  let brim: Brim;

  function site(icons?: IconLibrary): AdminHandler {
    return createAdminHandler({ brim, assetsDirectory: new URL("../editor-dist/", import.meta.url), icons });
  }

  async function get(admin: AdminHandler, path: string, cookie?: string): Promise<Response> {
    const response = await admin(new Request(`${ORIGIN}${path}`, { headers: cookie ? { cookie } : {} }), visitor);
    if (!response) throw new Error(`${path} was not handled`);
    return response;
  }

  async function signIn(admin: AdminHandler): Promise<string> {
    const response = await admin(
      new Request(`${ORIGIN}/admin/api/session`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGIN },
        body: JSON.stringify({ email: EMAIL, password: PASSWORD }), // betterleaks:allow
      }),
      visitor,
    );
    return (response?.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
  }

  beforeEach(async () => {
    const db = openDatabase(":memory:");
    await migrate(db);
    brim = {
      db,
      content: new ContentStore(db),
      items: new ItemStore(db),
      forms: new FormStore(db),
      history: new HistoryStore(db),
      drafts: new DraftStore(db),
      accounts: new Accounts(db),
    };
    await brim.accounts.createUser(EMAIL, PASSWORD, "owner");
  });

  it("lists the sets and shows the icon a block has", async () => {
    const admin = site(new IconLibrary({ builtIn: ["star"] }, [PACK]));
    const cookie = await signIn(admin);

    const sets = await get(admin, "/admin/api/icons", cookie);
    expect(await sets.json()).toEqual({
      sets: [
        { id: "brim", name: "Brim", total: 1 },
        { id: "acme", name: "Acme Icons", total: 4 },
      ],
    });

    const chosen = await get(admin, "/admin/api/icons?value=acme%3Amoon", cookie);
    expect(await chosen.json()).toMatchObject({ icon: { value: "acme:moon", viewBox: "0 0 32 32", outline: false } });
    const unknown = await get(admin, "/admin/api/icons?value=none", cookie);
    expect(await unknown.json()).toMatchObject({ icon: null });
  });

  it("searches one set", async () => {
    const admin = site(new IconLibrary({}, [PACK]));
    const cookie = await signIn(admin);

    const found = await get(admin, "/admin/api/icons/acme?q=rocket&limit=1", cookie);
    expect(await found.json()).toMatchObject({ icons: [{ value: "acme:rocket" }], total: 2 });
    const none = await get(admin, "/admin/api/icons/nothing", cookie);
    expect(await none.json()).toEqual({ icons: [], total: 0 });
  });

  it("offers Brim's own set on a site that configured nothing", async () => {
    const admin = site();
    const sets = (await (await get(admin, "/admin/api/icons", await signIn(admin))).json()) as { sets: unknown[] };
    expect(sets.sets).toMatchObject([{ id: "brim" }]);
  });

  it("answers only someone signed in", async () => {
    const admin = site();
    expect((await get(admin, "/admin/api/icons")).status).toBe(401);
    expect((await get(admin, "/admin/api/icons/brim")).status).toBe(401);
  });
});
