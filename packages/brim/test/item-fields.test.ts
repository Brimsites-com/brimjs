import { describe, expect, it } from "vitest";
import { defineContentType } from "../src/content/content-types.ts";
import { applyToItem, fieldText } from "../src/content/item-fields.ts";
import type { Item } from "../src/content/items.ts";

const event = defineContentType({
  key: "event",
  label: "Events",
  singular: "Event",
  slug: "events",
  fields: [
    { name: "date", label: "Date", type: "date", required: true },
    { name: "seats", label: "Seats", type: "number" },
    { name: "kind", label: "Kind", type: "select", options: ["Talk", "Workshop"] },
    { name: "room", label: "Room", type: "select", options: [{ value: "a", label: "Main hall" }] },
    { name: "featured", label: "Featured", type: "boolean" },
    { name: "tickets", label: "Tickets", type: "url" },
    { name: "contact", label: "Contact", type: "email" },
    { name: "gallery", label: "Gallery", type: "gallery" },
  ],
});

const item: Item = {
  id: "i1",
  type: "event",
  slug: "launch",
  title: "Launch",
  visibility: "published",
  data: { date: "2026-11-20", seats: 40 },
  locale: "",
  translationOf: null,
  position: 1,
  createdAt: "",
  updatedAt: "",
};

const field = (name: string) => event.fields.find((candidate) => candidate.name === name)!;

describe("fieldText", () => {
  it("writes a date and a number in the language given, with no time zone moving the day", () => {
    expect(fieldText(field("date"), "2026-11-20", "ro")).toBe("20 noiembrie 2026");
    expect(fieldText(field("date"), "2026-01-01", "en-US")).toBe("January 1, 2026");
    expect(fieldText(field("seats"), 2024, "en")).toBe("2024");
    expect(fieldText(field("seats"), 12500.5, "en")).toBe("12,500.5");
  });

  it("writes a set boolean as its label, the rest as it is, and empty as nothing", () => {
    expect(fieldText(field("featured"), true)).toBe("Featured");
    expect(fieldText(field("featured"), false)).toBe("");
    expect(fieldText(field("kind"), "Talk")).toBe("Talk");
    expect(fieldText(field("room"), "a")).toBe("Main hall");
    expect(fieldText(field("seats"), undefined)).toBe("");
  });

  it("falls back to the default language for a code Intl does not know", () => {
    expect(fieldText(field("seats"), 7, "not a language!")).toBe("7");
  });
});

describe("applyToItem with a field element", () => {
  it("saves the picked value into the item, checked like the item form", () => {
    expect(applyToItem(event, item, "kind", "field", { value: "Workshop" }).data.kind).toBe("Workshop");
    expect(applyToItem(event, item, "featured", "field", { value: true }).data.featured).toBe(true);
    expect(applyToItem(event, item, "seats", "field", { value: "" }).data).not.toHaveProperty("seats");
    expect(() => applyToItem(event, item, "kind", "field", { value: "Party" })).toThrow(/not one of the choices/);
    expect(() => applyToItem(event, item, "date", "field", { value: "" })).toThrow(/required/);
    expect(() => applyToItem(event, item, "date", "field", { value: "20.11.2026" })).toThrow(/must be a date/);
  });

  it("refuses a field it does not show", () => {
    expect(() => applyToItem(event, item, "gallery", "field", { value: [] })).toThrow(/cannot show/);
    expect(() => applyToItem(event, item, "title", "field", { value: "x" })).toThrow(/cannot show/);
  });
});
