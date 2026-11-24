/**
 * The TypeScript types of items, inferred from the fields a content type declares, so code reads `item.data.price`
 * as a number and a misspelt field fails at build time instead of showing nothing on the site:
 *
 *   export const product = defineContentType({ key: "product", …, fields: [
 *     { name: "price", label: "Price", type: "number", required: true },
 *     { name: "category", label: "Category", vocabulary: "category" },
 *   ] });
 *   type Product = ItemOf<typeof product>;   // data: { price: number; category?: string; … }
 *   const products = await getItems(product); // Product[]
 *
 * Types only: nothing here runs, so the editor and the server share it.
 */
import type { ImageValue, RichTextValue } from "./types.ts";

/** One row of a `keyvalue` field. */
export interface KeyValueRow {
  label: string;
  value: string;
}

/** One block of a `blocks` field. */
export interface BlockRow {
  id: string;
  type: string;
  value: Record<string, unknown>;
}

/** The shape of a field as declared, as far as its type goes. */
interface DeclaredField {
  readonly name: string;
  readonly type?: string;
  readonly required?: boolean;
  readonly multiple?: boolean;
  readonly vocabulary?: string;
  readonly options?: readonly unknown[];
}

/** What a select field saves: the values of its choices, plain strings or `{ value, label }`. */
type ChoiceValue<O> = O extends string ? O : O extends { readonly value: infer V extends string } ? V : string;

/** The value a field holds, from its type. */
export type FieldValue<F extends DeclaredField> = F extends { readonly vocabulary: string }
  ? F extends { readonly multiple: true }
    ? string[]
    : string
  : F extends { readonly type: "reference" }
    ? F extends { readonly multiple: true }
      ? string[]
      : string
    : F extends { readonly type: "text" | "textarea" | "email" | "url" | "date" }
      ? string
      : F extends { readonly type: "number" }
        ? number
        : F extends { readonly type: "boolean" }
          ? boolean
          : F extends { readonly type: "select"; readonly options: readonly (infer O)[] }
            ? ChoiceValue<O>
            : F extends { readonly type: "tags" }
              ? string[]
              : F extends { readonly type: "keyvalue" }
                ? KeyValueRow[]
                : F extends { readonly type: "image" }
                  ? ImageValue
                  : F extends { readonly type: "gallery" }
                    ? ImageValue[]
                    : F extends { readonly type: "richtext" }
                      ? RichTextValue
                      : F extends { readonly type: "blocks" }
                        ? BlockRow[]
                        : unknown;

type Simplify<T> = { [K in keyof T]: T[K] } & {};

/**
 * An item's `data` for these fields: required ones always there, the others optional. Every type also has the
 * `author` and `tags` fields Brim adds unless it leaves them out, typed here as optional.
 */
export type FieldsData<Fields extends readonly DeclaredField[]> = Simplify<
  { [F in Fields[number] as F extends { readonly required: true } ? F["name"] : never]: FieldValue<F> } & {
    [F in Fields[number] as F extends { readonly required: true } ? never : F["name"]]?: FieldValue<F>;
  } & { author?: string; tags?: string[] }
>;

/** The site settings' values for these fields: each one there unless empty, when it is `null` or missing. */
export type SettingsData<Fields extends readonly DeclaredField[]> = Simplify<{
  [F in Fields[number] as F["name"]]?: FieldValue<F> | null;
}>;

/** A content type that knows the type of its items' data, as `defineContentType` returns it. */
export interface Typed<Data> {
  /** Never set: it carries the type of the items' data for `ItemOf`, `getItems` and `ItemPageProps`. */
  readonly __data?: Data;
}

/** The data of a typed content type's items, or an open record for one declared without its fields' types. */
export type DataOf<T> = T extends Typed<infer Data> ? (unknown extends Data ? Record<string, unknown> : Data) : Record<string, unknown>;
