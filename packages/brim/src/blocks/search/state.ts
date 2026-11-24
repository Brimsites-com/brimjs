import type { ContentItem } from "../../runtime/content.ts";

/** One item a site search found, as its markup draws it. */
export interface SearchResult {
  item: ContentItem;
  /** Key of the item's content type, and the name of one of its items (`Article`). */
  type: string;
  typeLabel: string;
  title: string;
  /** The address of the item's page. */
  url: string;
  /** The sentence the words were found in, as plain text. */
  excerpt: string;
}

/** What a `<Search>` function child gets: the words, one page of results and the way to the others. */
export interface SearchState {
  /** The words searched for, as typed; "" before anything is asked. */
  query: string;
  /** The address parameter of the words, the `name` of the site's own search box. */
  param: string;
  results: SearchResult[];
  /** How many items were found, over every page. */
  total: number;
  page: number;
  pageCount: number;
  pageHref: (page: number) => string;
}
