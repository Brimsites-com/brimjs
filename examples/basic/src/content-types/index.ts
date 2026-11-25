import { defineContentType, defineVocabulary } from "brimjs";
import PostPage from "./PostPage.astro";
import ProductPage from "./ProductPage.astro";
import ProjectPage from "./ProjectPage.astro";

const project = defineContentType({
  key: "project",
  label: "Projects",
  singular: "Project",
  slug: "projects",
  component: ProjectPage,
  feed: { description: "New work from the studio." }, // the RSS feed at /rss/projects.xml
  fields: [
    // The description and the picture every item with a page has, labelled as this site calls them.
    { name: "description", label: "Summary", type: "textarea", required: true },
    { name: "image", label: "Cover image", type: "image" },
    { name: "location", label: "Location", type: "text" },
    { name: "year", label: "Year", type: "number" },
    { name: "story", label: "Story", type: "richtext" },
    { name: "content", label: "Content", type: "blocks", blocks: ["richtext", "image", "button"] },
  ],
});

// Each product's page is under its category: /shop/lamps/arc-lamp.
const product = defineContentType({
  key: "product",
  label: "Products",
  singular: "Product",
  slug: "products",
  path: "/shop/[category]/[slug]",
  component: ProductPage,
  fields: [
    {
      name: "category",
      label: "Category",
      type: "select",
      // The value goes into the address (/shop/lamps/…), the label is what the owner and visitors read.
      options: [
        { value: "lamps", label: "Lamps" },
        { value: "chairs", label: "Chairs" },
      ],
      required: true,
    },
    { name: "description", label: "Summary", type: "textarea" },
    { name: "specs", label: "Specifications", type: "keyvalue" },
    { name: "released", label: "Released", type: "date" },
    // Terms of the materials vocabulary below: offered as you type, and added to it from the product's form.
    { name: "materials", label: "Materials", vocabulary: "material", multiple: true },
  ],
});

// A list the owner keeps: materials are items, renamed and added in Content or straight from a product.
const material = defineVocabulary({ key: "material", label: "Materials", singular: "Material", slug: "materials", fields: [] });

// Articles: Brim adds their description, image, date, author and tags, and tells search engines about them.
const post = defineContentType({
  key: "post",
  label: "Journal",
  singular: "Post",
  slug: "journal",
  component: PostPage,
  article: true,
  feed: true,
  fields: [
    { name: "author", label: "Written by", vocabulary: "writer" },
    { name: "body", label: "Body", type: "blocks" },
  ],
});

const writer = defineVocabulary({
  key: "writer",
  label: "Writers",
  singular: "Writer",
  slug: "writers",
  fields: [{ name: "profile", label: "Profile", type: "url" }],
});

/** Brim reads this list; a change shows up in the editor and the pages without restarting. */
export const contentTypes = [project, product, material, post, writer];
