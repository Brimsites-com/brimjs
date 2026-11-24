import { describe, expect, it } from "vitest";
import { defineContentType } from "../src/content/content-types.ts";
import { parseItem } from "../src/content/items.ts";
import { hasTag, parseTags, rankTags } from "../src/content/tags.ts";

describe("parseTags", () => {
  it("trims each tag, keeps one of each whatever its case, and drops empty ones", () => {
    expect(parseTags([" Garden ", "lawn  care", "garden", "", "  "], "Tags")).toEqual(["Garden", "lawn care"]);
  });

  it("refuses what is not a list of text, and tags that are too long or too many", () => {
    expect(() => parseTags("garden", "Tags")).toThrow('"Tags" must be a list of tags.');
    expect(() => parseTags([1], "Tags")).toThrow("list of tags");
    expect(() => parseTags(["x".repeat(61)], "Tags")).toThrow("longer than 60");
    expect(() =>
      parseTags(
        Array.from({ length: 51 }, (_, index) => `t${index}`),
        "Tags",
      ),
    ).toThrow("at most 50");
  });

  it("takes only the tags a field offers, when it has a list of its own, spelled as the list spells them", () => {
    expect(parseTags(["Kitchen", "bedroom", "KITCHEN"], "Rooms", ["Kitchen", "Bedroom"])).toEqual([
      "Kitchen",
      "Bedroom",
    ]);
    expect(() => parseTags(["Garage"], "Rooms", ["Kitchen", "Bedroom"])).toThrow('does not offer the tag "Garage"');
  });
});

describe("an item's tags", () => {
  const article = defineContentType({
    key: "article",
    label: "Articles",
    singular: "Article",
    slug: "blog",
    fields: [],
  });
  const draft = (tags: unknown) => parseItem(article, { title: "Spring", visibility: "private", data: { tags } });

  it("are kept as a list, and left out when there are none", () => {
    expect(draft(["Garden", "garden"]).data).toEqual({ tags: ["Garden"] });
    expect(draft([" "]).data).toEqual({});
    expect(draft([]).data).toEqual({});
  });
});

describe("rankTags and hasTag", () => {
  it("count each tag once per list, most used first, with the spelling it was first given", () => {
    expect(rankTags([["Garden", "Lawn"], ["garden"], undefined, ["Trees", "Garden"]])).toEqual([
      { tag: "Garden", count: 3 },
      { tag: "Lawn", count: 1 },
      { tag: "Trees", count: 1 },
    ]);
  });

  it("find a tag whatever its case", () => {
    expect(hasTag(["Garden"], "garden")).toBe(true);
    expect(hasTag(["Garden"], "lawn")).toBe(false);
  });
});
