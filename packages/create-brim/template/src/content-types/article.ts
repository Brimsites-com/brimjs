import { defineContentType } from "@brimsites/brimjs";
import ArticlePage from "./ArticlePage.astro";

/**
 * Articles are written in the editor; each one gets a page at /blog/<address>, drawn by ArticlePage. Brim adds their
 * description, image, published date, author and tags, and gives them to search engines; declare one here only to
 * change its label or make it required, as the description is.
 */
export const article = defineContentType({
  key: "article",
  label: "Articles",
  singular: "Article",
  slug: "blog",
  component: ArticlePage,
  article: true,
  fields: [
    {
      name: "description",
      label: "Description",
      type: "textarea",
      required: true,
      help: "Shown on cards and in search results.",
    },
    {
      name: "body",
      label: "Body",
      type: "blocks",
      help: "Text, images, videos and more, added on the article's page.",
    },
  ],
});
