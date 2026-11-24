import { assertNodeId, isNodeId, siteScope } from "../content/ids.ts";
import { resolveSettings } from "../blocks/settings.ts";
import type { BlockDefinition } from "../blocks/types.ts";
import { type BlockLayout, layoutOf } from "../content/block-layout.ts";
import { blocksOf } from "../content/block-values.ts";
import type { ItemBinding } from "../content/item-fields.ts";
import type { NodeKind, NodeValues, SeoSettings, StoredNode } from "../content/types.ts";

/**
 * Where a node's value is kept: with its page (on an item's page, its type's template), with the whole site, or in
 * a `blocks` field of an item (`item:…`, handed out by `blocks()`).
 */
export type NodeScope = "page" | "site" | `item:${string}`;

/** What the primitives on one page can read: the owner's values for this page and for the whole site. */
export class BrimContext {
  /** `page:<path>`, or `type:<key>` on the page of an item, whose nodes belong to its type's template. */
  readonly #pageScope: string;
  readonly #siteScope: string;
  /** True only while the editor can be open; the public build leaves no trace of it. */
  readonly editing: boolean;
  readonly #nodes = new Map<string, StoredNode>();
  /** The item and field behind each `item:…` scope that `blocks()` handed out. */
  readonly #stacks = new Map<string, ItemBinding>();
  /** The owner's SEO settings for this page. */
  readonly seo: SeoSettings;
  /** On an item's page, the item's own picture: the preview image when neither the owner nor the code set one. */
  readonly itemImage: string | undefined;
  /** On an item's page, the item's author: the page's `<meta name="author">` when the code gives none. */
  readonly itemAuthor: string | undefined;

  constructor(
    pageScope: string,
    locale: string | undefined,
    nodes: StoredNode[],
    editing = false,
    seo: SeoSettings = {},
    itemImage?: string,
    itemAuthor?: string,
  ) {
    this.editing = editing;
    this.seo = seo;
    this.itemImage = itemImage;
    this.itemAuthor = itemAuthor;
    this.#pageScope = pageScope;
    this.#siteScope = siteScope(locale);
    for (const node of nodes) this.#nodes.set(key(node.scope, node.nodeId), node);
  }

  /**
   * The owner's value for a node, or `undefined` when the source default applies.
   * A stored value of another kind is ignored: the source changed what the node is.
   */
  read<K extends NodeKind>(kind: K, nodeId: string, scope: NodeScope = "page"): NodeValues[K] | undefined {
    return this.#stored(kind, nodeId, scope) as NodeValues[K] | undefined;
  }

  /** A block's settings: its defaults, then what the page's code passes, then what the owner saved. */
  settings(
    definition: BlockDefinition,
    nodeId: string,
    scope: NodeScope,
    source: Record<string, unknown>,
  ): Record<string, unknown> {
    const stored = this.#stored(definition.type, nodeId, scope) as Record<string, unknown> | undefined;
    return resolveSettings(definition, source, stored);
  }

  /**
   * The blocks the owner stacked in a `blocks` field of an item, for `<Blocks>` to draw: each block reads its value
   * through the nodeId and scope given here, like any node, and its edits go back into the item.
   */
  blocks(
    item: ItemBinding["item"],
    field: string,
  ): { nodeId: string; kind: string; scope: NodeScope; layout: BlockLayout }[] {
    const scope = `item:${item.id}:${field}` as const;
    this.#stacks.set(scope, { item, field });
    const entries = blocksOf(item.data[field]);
    // Saved blocks are checked, but one written some other way with an id that is not a nodeId is left out.
    return entries
      .filter((entry) => isNodeId(String(entry?.id)))
      .map(({ id, type, value, layout }) => {
        this.#nodes.set(key(scope, id), { scope, nodeId: id, kind: type, value });
        return { nodeId: id, kind: type, scope, layout: layoutOf(type, layout, value) };
      });
  }

  #stored(kind: string, nodeId: string, scope: NodeScope): unknown {
    assertNodeId(nodeId);
    const scopeKey = scope === "site" ? this.#siteScope : scope === "page" ? this.#pageScope : scope;
    const node = this.#nodes.get(key(scopeKey, nodeId));
    return node?.kind === kind ? node.value : undefined;
  }

  /**
   * Attributes that let the editor find a node on the page. Empty on the public site.
   * Pass `value` for kinds whose markup is written by the site author, so the editor can read it back,
   * and `binding` for an element that shows a field of an item, so its edits are saved into the item.
   */
  marker(
    kind: string,
    nodeId: string,
    scope: NodeScope,
    value?: unknown,
    binding?: ItemBinding,
  ): Record<string, string> {
    if (!this.editing) return {};
    // A block of an item's `blocks` field is the item's content, like a field, and names its place in the field.
    const stack = this.#stacks.get(scope);
    if (stack) return { ...this.marker(kind, nodeId, "page", value, stack), "data-brim-entry": nodeId };
    return {
      "data-brim-node": nodeId,
      "data-brim-kind": kind,
      // The editor tells the template's parts from the item's own fields, which also carry `data-brim-item`.
      "data-brim-scope": scope === "page" && this.#pageScope.startsWith("type:") ? "template" : scope,
      ...(value !== undefined && { "data-brim-value": JSON.stringify(value) }),
      ...(binding && {
        "data-brim-item": binding.item.id,
        "data-brim-item-type": binding.item.type,
        "data-brim-item-title": binding.item.title,
        "data-brim-field": binding.field,
      }),
    };
  }
}

function key(scope: string, nodeId: string): string {
  return `${scope}\n${nodeId}`;
}
