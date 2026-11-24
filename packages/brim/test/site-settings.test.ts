import { describe, expect, it } from "vitest";
import { checkSite } from "../src/check.ts";
import { defineSiteSettings, parseSettings, settingsValues } from "../src/content/site-settings.ts";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const settings = defineSiteSettings({
  fields: [
    { name: "phone", label: "Phone", type: "text", group: "Contact", default: "+40 700 000 000" },
    { name: "email", label: "Email", type: "email", group: "Contact", required: true },
    { name: "hours", label: "Hours", type: "keyvalue", group: "Contact" },
    { name: "tiktok", label: "TikTok", type: "url", group: "Social", default: "https://www.tiktok.com/@acme" },
  ],
});

describe("declaring the site's own settings", () => {
  it("keeps each field's section and default, and checks the defaults like saved values", () => {
    expect(settings.fields.map(({ name, group, default: value }) => ({ name, group, value }))).toEqual([
      { name: "phone", group: "Contact", value: "+40 700 000 000" },
      { name: "email", group: "Contact", value: undefined },
      { name: "hours", group: "Contact", value: undefined },
      { name: "tiktok", group: "Social", value: "https://www.tiktok.com/@acme" },
    ]);
    expect(settings.defaults).toEqual({ phone: "+40 700 000 000", tiktok: "https://www.tiktok.com/@acme" });
    expect(() =>
      defineSiteSettings({ fields: [{ name: "email", label: "Email", type: "email", default: "nope" }] }),
    ).toThrow(/defaults of the site settings are not valid/);
    expect(() => defineSiteSettings({ fields: [{ name: "body", label: "Body", type: "blocks" }] })).toThrow();
  });

  it("checks saved values like an item's fields, and keeps a field the owner emptied empty", () => {
    expect(parseSettings(settings.fields, { email: "a@b.ro", hours: [{ label: "Luni", value: "9–18" }] })).toEqual({
      email: "a@b.ro",
      hours: [{ label: "Luni", value: "9–18" }],
    });
    expect(() => parseSettings(settings.fields, { email: "nope" })).toThrow(/email/);
    expect(() => parseSettings(settings.fields, {})).toThrow(/required/);

    const cleared = parseSettings(settings.fields, { email: "a@b.ro", tiktok: "" });
    expect(settingsValues(settings, cleared)).toMatchObject({ phone: "+40 700 000 000", tiktok: null });
  });
});

describe("brim check: contact details in the code", () => {
  it("warns about email, phone, WhatsApp and social links outside src/site-settings.ts", () => {
    const root = mkdtempSync(join(tmpdir(), "brim-settings-"));
    const files: Record<string, string> = {
      "src/data/site.ts": [
        'export const EMAIL = "mailto:office@acme.ro";',
        'export const WHATSAPP = "https://wa.me/40700000000";',
        'export const INSTAGRAM = "https://www.instagram.com/acme/";',
      ].join("\n"),
      "src/components/Footer.astro": '<a href={`tel:${phone}`}><Setting name="phone" /></a>',
      "src/site-settings.ts": '{ name: "tiktok", default: "https://www.tiktok.com/@acme" }',
    };
    for (const [name, content] of Object.entries(files)) {
      mkdirSync(dirname(join(root, name)), { recursive: true });
      writeFileSync(join(root, name), content);
    }
    const found = checkSite(root, { starter: [] }).findings.filter((finding) => finding.rule === "contact-in-code");
    expect(found.map(({ file, line }) => ({ file, line }))).toEqual([{ file: "src/data/site.ts", line: 1 }]);
    expect(found[0]?.message).toMatch(/^3 contact details/);
  });
});
