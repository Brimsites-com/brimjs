import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { addIntegration, addLanguage, init } from "../src/init.ts";

function project(files: Record<string, string>): string {
  const directory = mkdtempSync(join(tmpdir(), "brim-init-"));
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(dirname(join(directory, name)), { recursive: true });
    writeFileSync(join(directory, name), content);
  }
  return directory;
}
const read = (directory: string, name: string): string => readFileSync(join(directory, name), "utf8");

describe("brim init", () => {
  it("adds the integration to configs written the usual ways", () => {
    expect(addIntegration(`import { defineConfig } from "astro/config";\n\nexport default defineConfig({});\n`)).toBe(
      `import brim from "brimjs";\nimport { defineConfig } from "astro/config";\n\nexport default defineConfig({\n  integrations: [brim()],});\n`,
    );
    expect(addIntegration(`export default defineConfig({ integrations: [] });`)).toContain("integrations: [brim()] }");
    expect(addIntegration(`export default defineConfig({ integrations: [mdx(), sitemap()] });`)).toContain(
      "integrations: [brim(), mdx(), sitemap()]",
    );
    expect(addIntegration(`export default defineConfig({\n  integrations: [\n    mdx(),\n  ],\n});`)).toContain(
      "integrations: [\n    brim(),\n    mdx(),\n  ]",
    );
    expect(addIntegration(`export default { site: "https://x.test" };`)).toContain("integrations: [brim()],");
    // Already there: left as it is. Written in a way that cannot be changed safely: left to the person.
    const done = `import brim from "brimjs";\nexport default defineConfig({ integrations: [brim()] });`;
    expect(addIntegration(done)).toBe(done);
    expect(addIntegration(`export default makeConfig();`)).toBeUndefined();
  });

  it("sets up an existing Astro project, and changes nothing the second time", async () => {
    const directory = project({
      "package.json": JSON.stringify(
        { name: "site", scripts: { dev: "astro dev" }, dependencies: { astro: "^7.0.0" } },
        null,
        2,
      ),
      "astro.config.mjs": `import { defineConfig } from "astro/config";\nimport mdx from "@astrojs/mdx";\n\nexport default defineConfig({\n  integrations: [mdx()],\n});\n`,
      ".gitignore": "node_modules\ndist\n",
      "AGENTS.md": "# Site\n\nOur notes.\n",
    });
    const first = await init(directory, { brim: "^1.2.3" });
    expect(first.manual).toEqual([]);

    const manifest = JSON.parse(read(directory, "package.json")) as Record<string, Record<string, string>>;
    expect(manifest.dependencies).toEqual({ astro: "^7.0.0", brimjs: "^1.2.3" });
    expect(manifest.devDependencies).toBeUndefined();
    expect(manifest.scripts).toEqual({ dev: "astro dev", start: "brim start", brim: "brim" });
    expect(read(directory, "astro.config.mjs")).toContain(`import brim from "brimjs";`);
    expect(read(directory, "astro.config.mjs")).toContain("integrations: [brim(), mdx()]");
    expect(read(directory, ".gitignore")).toBe(
      "node_modules\ndist\n# Brim.js: the local database (content, users, form responses) and images uploaded in the editor.\n.brim\npublic/uploads\n",
    );
    expect(read(directory, ".claude/skills/brim-convert/SKILL.md")).toContain("name: brim-convert");
    expect(read(directory, "AGENTS.md")).toMatch(/^# Site\n\nOur notes\.\n\n<!-- brimjs -->\n## Brim\.js/);
    expect(read(directory, "CLAUDE.md")).toBe("@AGENTS.md\n");

    const before = ["package.json", "astro.config.mjs", ".gitignore", "AGENTS.md"].map((name) => read(directory, name));
    const second = await init(directory, { brim: "^9.9.9" });
    expect(second.done).toEqual([]);
    expect(
      ["package.json", "astro.config.mjs", ".gitignore", "AGENTS.md"].map((name) => read(directory, name)),
    ).toEqual(before);
  });

  it("creates the config a project lacks, and says what it could not do", async () => {
    const bare = project({ "package.json": JSON.stringify({ devDependencies: { astro: "^7.0.0" } }) });
    await init(bare);
    expect(read(bare, "astro.config.mjs")).toContain("integrations: [brim()]");

    const odd = project({
      "package.json": JSON.stringify({ dependencies: { astro: "^7.0.0" } }),
      "astro.config.ts": "export default makeConfig();\n",
    });
    expect((await init(odd)).manual[0]).toMatch(/Add Brim to astro\.config\.ts yourself/);
    expect(read(odd, "astro.config.ts")).toBe("export default makeConfig();\n");
  });

  it("declares the site's language, from --lang, else the layout's <html lang>, else en", async () => {
    const astro = { dependencies: { astro: "^7.0.0" } };
    const config = `import { defineConfig } from "astro/config";\n\nexport default defineConfig({});\n`;
    const fromLayout = project({
      "package.json": JSON.stringify(astro),
      "astro.config.mjs": config,
      "src/layouts/Base.astro": `---\n---\n<html lang="ro"><body><slot /></body></html>\n`,
    });
    const done = (await init(fromLayout)).done;
    expect(read(fromLayout, "astro.config.mjs")).toContain(`i18n: { defaultLocale: "ro", locales: ["ro"] },`);
    expect(done).toContain("Declared the site's language (ro) in astro.config.mjs.");

    const given = project({ "package.json": JSON.stringify(astro), "astro.config.mjs": config });
    await init(given, { lang: "de" });
    expect(read(given, "astro.config.mjs")).toContain(`defaultLocale: "de"`);

    const bare = project({ "package.json": JSON.stringify(astro) });
    await init(bare);
    expect(read(bare, "astro.config.mjs")).toContain(`i18n: { defaultLocale: "en", locales: ["en"] },`);

    await expect(init(project({ "package.json": JSON.stringify(astro) }), { lang: "Romanian" })).rejects.toThrow(
      /not a language code/,
    );
  });

  it("keeps the languages a config declares already", () => {
    const declared = `export default defineConfig({\n  i18n: { defaultLocale: "en", locales: ["en", "ro"] },\n});\n`;
    expect(addLanguage(declared, "ro")).toBe(declared);
  });

  it("refuses a folder that is not an Astro project", async () => {
    await expect(init(project({}))).rejects.toThrow(/no package\.json/);
    await expect(init(project({ "package.json": "{}" }))).rejects.toThrow(/does not depend on astro/);
  });

  it("puts a project that is not in git into git, without committing anything", async () => {
    const astro = JSON.stringify({ dependencies: { astro: "^7.0.0" } });
    const directory = project({ "package.json": astro });
    const result = await init(directory);
    expect(existsSync(join(directory, ".git"))).toBe(true);
    expect(result.done.at(-1)).toMatch(/git init.*Commit once you have checked/);
    // In git already, or asked not to: left alone.
    expect((await init(directory)).done.join(" ")).not.toMatch(/git init/);
    const skipped = project({ "package.json": astro });
    await init(skipped, { git: false });
    expect(existsSync(join(skipped, ".git"))).toBe(false);
  });
});
