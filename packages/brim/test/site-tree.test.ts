import { describe, expect, it } from "vitest";
import { defineContentType, defineVocabulary } from "../src/content/content-types.ts";
import type { ContentType, Item, SitePage } from "../src/editor/client/api.ts";
import { buildSiteTree } from "../src/editor/client/site-tree.ts";

const asEditor = (type: ReturnType<typeof defineContentType>, hasPage: boolean): ContentType => {
  const { component: _component, ...rest } = type as typeof type & { component?: unknown };
  return { ...rest, hasPage } as ContentType;
};

const category = asEditor(
  defineVocabulary({ key: "category", label: "Categories", singular: "Category", slug: "categories", fields: [] }),
  false,
);
const product = asEditor(
  defineContentType({
    key: "product",
    label: "Products",
    singular: "Product",
    slug: "products",
    path: "/produse/[category]/[slug]",
    component: () => "",
    fields: [{ name: "category", label: "Category", vocabulary: "category", required: true }],
  }),
  true,
);
const article = asEditor(
  defineContentType({
    key: "article",
    label: "Articles",
    singular: "Article",
    slug: "blog",
    component: () => "",
    fields: [],
  }),
  true,
);
const testimonial = asEditor(
  defineContentType({ key: "testimonial", label: "Testimonials", singular: "Testimonial", slug: "t", fields: [] }),
  false,
);

const page = (path: string): SitePage => ({ path, visibility: "published", seo: {} });
const item = (type: string, slug: string, title: string, data: Record<string, unknown> = {}, locale = ""): Item => ({
  id: `${type}-${slug}-${locale}`,
  type,
  slug,
  title,
  visibility: "published",
  data,
  locale,
  translationOf: null,
  updatedAt: "1",
});

describe("the site map as one tree", () => {
  const items = {
    category: [
      item("category", "mozaic", "Mozaic"),
      item("category", "ceramica", "Ceramică"),
      item("category", "lemn", "Lemn"),
    ],
    product: [
      item("product", "bloc", "Bloc", { category: "ceramica" }),
      item("product", "art", "Art", { category: "ceramica" }),
      item("product", "tessera", "Tessera", { category: "mozaic" }),
      item("product", "art", "Art EN", { category: "ceramica" }, "en"),
    ],
    article: [item("article", "salut", "Salut")],
    testimonial: [],
  };

  it("hangs a type's items under the page their address starts with, split by the field after it", () => {
    const tree = buildSiteTree(
      [page("/"), page("/produse"), page("/blog")],
      [category, product, article, testimonial],
      items,
      undefined,
    );
    const products = tree.branches.find((branch) => branch.type.key === "product")!;
    expect(products).toMatchObject({
      parent: "/produse",
      prefix: "/produse",
      groupBy: { name: "category", to: "category" },
    });
    expect(products.groups.map((group) => [group.label, group.path, group.items.map((entry) => entry.path)])).toEqual([
      ["Ceramică", "/produse/ceramica", ["/produse/ceramica/art", "/produse/ceramica/bloc"]],
      ["Lemn", "/produse/lemn", []],
      ["Mozaic", "/produse/mozaic", ["/produse/mozaic/tessera"]],
    ]);
    expect(products.items).toHaveLength(3);

    const articles = tree.branches.find((branch) => branch.type.key === "article")!;
    expect(articles).toMatchObject({ parent: "/blog", groups: [] });
    expect(articles.items.map((entry) => entry.path)).toEqual(["/blog/salut"]);

    expect(tree.unplaced.map((type) => type.key)).toEqual(["category", "testimonial"]);
  });

  it("puts a type at the top when no page but the home page starts its address", () => {
    const tree = buildSiteTree([page("/")], [category, product], items, undefined);
    expect(tree.branches[0]).toMatchObject({ parent: null, prefix: "/produse" });
    expect(buildSiteTree([], [category, product], items, undefined).branches[0]?.parent).toBeNull();
  });

  it("opens a term's page from its group when the vocabulary gives its terms pages, and lists it there only", () => {
    const withPages = asEditor(
      defineVocabulary({
        key: "category",
        label: "Categories",
        singular: "Category",
        slug: "categories",
        path: "/produse/[slug]",
        component: () => "",
        fields: [],
      }),
      true,
    );
    const brand = asEditor(
      defineVocabulary({
        key: "brand",
        label: "Brands",
        singular: "Brand",
        slug: "branduri",
        component: () => "",
        fields: [],
      }),
      true,
    );
    const tree = buildSiteTree([page("/"), page("/produse")], [withPages, brand, product], items, undefined);
    const products = tree.branches.find((branch) => branch.type.key === "product")!;
    expect(products.groups.map((group) => [group.label, group.page, group.term?.slug])).toEqual([
      ["Ceramică", "/produse/ceramica", "ceramica"],
      ["Lemn", "/produse/lemn", "lemn"],
      ["Mozaic", "/produse/mozaic", "mozaic"],
    ]);
    // The categories are the products' groups, not a branch of their own; brands, used by none, are one.
    expect(tree.branches.map((branch) => branch.type.key)).toEqual(["brand", "product"]);
    expect(tree.unplaced).toEqual([]);
    // Without pages, a group has nothing to open.
    expect(
      buildSiteTree([page("/produse")], [category, product], items, undefined).branches[0]?.groups[0]?.page,
    ).toBeUndefined();
  });

  it("keeps the owner's order of an ordered type and of an ordered vocabulary's groups", () => {
    const orderedCategory = { ...category, ordered: true };
    const orderedProduct = { ...product, ordered: true };
    const tree = buildSiteTree([page("/produse")], [orderedCategory, orderedProduct], items, undefined);
    const products = tree.branches[0]!;
    // The API lists them in the owner's order: Mozaic, Ceramică, Lemn; Bloc before Art.
    expect(products.groups.map((group) => group.label)).toEqual(["Mozaic", "Ceramică", "Lemn"]);
    expect(products.groups[1]!.items.map((entry) => entry.item.title)).toEqual(["Bloc", "Art"]);
  });

  describe("a catalog of ceramics", () => {
    const style = asEditor(
      defineVocabulary({
        key: "style",
        label: "Styles",
        singular: "Style",
        slug: "stiluri",
        path: "/produse/ceramica/stil/[slug]",
        component: () => "",
        ordered: true,
        fields: [],
      }),
      true,
    );
    const catalog = asEditor(
      defineVocabulary({
        key: "catalog",
        label: "Catalogs",
        singular: "Catalog",
        slug: "cataloage",
        path: "/produse/ceramica/catalog/[slug]",
        component: () => "",
        fields: [],
      }),
      true,
    );
    const withPages = asEditor(
      defineVocabulary({
        key: "category",
        label: "Categories",
        singular: "Category",
        slug: "categories",
        path: "/produse/[slug]",
        component: () => "",
        fields: [],
      }),
      true,
    );
    const tile = asEditor(
      defineContentType({
        key: "product",
        label: "Products",
        singular: "Product",
        slug: "products",
        path: "/produse/[category]/[slug]",
        component: () => "",
        fields: [
          { name: "category", label: "Category", vocabulary: "category", required: true },
          { name: "style", label: "Style", vocabulary: "style" },
          { name: "catalog", label: "Catalog", vocabulary: "catalog" },
        ],
      }),
      true,
    );
    const ceramics = Array.from({ length: 12 }, (_, index) =>
      item("product", `p${index}`, `P${index}`, {
        category: "ceramica",
        ...(index < 11 && { style: index % 2 ? "wood" : "luxury" }),
      }),
    );
    const data = {
      category: [item("category", "ceramica", "Ceramică"), item("category", "mozaic", "Mozaic")],
      style: [item("style", "wood", "Wood"), item("style", "luxury", "Luxury")],
      catalog: [item("catalog", "petracers", "Petracer's")],
      product: [...ceramics, item("product", "tessera", "Tessera", { category: "mozaic", style: "wood" })],
    };
    const tree = buildSiteTree([page("/"), page("/produse")], [withPages, style, catalog, tile], data, undefined);
    const products = tree.branches.find((branch) => branch.type.key === "product")!;
    const [ceramica, mozaic] = products.groups;

    it("splits a group too long to list by the vocabulary most of its items use", () => {
      expect(ceramica!.subgroupBy).toMatchObject({ name: "style", to: "style" });
      expect(
        ceramica!.groups.map((group) => [group.label, group.page, group.data, group.items.length, group.key]),
      ).toEqual([
        ["Wood", "/produse/ceramica/stil/wood", { category: "ceramica", style: "wood" }, 5, "product/ceramica/wood"],
        [
          "Luxury",
          "/produse/ceramica/stil/luxury",
          { category: "ceramica", style: "luxury" },
          6,
          "product/ceramica/luxury",
        ],
      ]);
      expect(ceramica!.rest.map((entry) => entry.item.slug)).toEqual(["p11"]);
      expect(ceramica!.items).toHaveLength(12);
      // A short group is listed as it is.
      expect(mozaic).toMatchObject({ groups: [], rest: [{ item: { slug: "tessera" } }] });
    });

    it("hangs a type under the page of a group's term, and drops a vocabulary whose terms are all subgroups", () => {
      expect(tree.branches.map((branch) => [branch.type.key, branch.parent])).toEqual([
        ["catalog", "/produse/ceramica"],
        ["product", "/produse"],
      ]);
    });
  });
});
