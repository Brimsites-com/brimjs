import { defineContentType } from "brimjs";
import ArticlePage from "./ArticlePage.astro";

/** Articles are written in the editor; each one gets a page at /blog/<address>, drawn by ArticlePage. */
export const article = defineContentType({
  key: "article",
  label: "Articles",
  singular: "Article",
  slug: "blog",
  component: ArticlePage,
  fields: [
    {
      name: "summary",
      label: "Summary",
      type: "textarea",
      required: true,
      help: "Shown on cards and in search results.",
    },
    { name: "cover", label: "Cover image", type: "image" },
    { name: "published", label: "Date", type: "date" },
    {
      name: "body",
      label: "Body",
      type: "blocks",
      help: "Text, images, videos and more, added on the article's page.",
    },
  ],
});
