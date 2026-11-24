import type { FooterValue, ImageValue, NavItem, NavLink, NavbarValue } from "./types.ts";

/**
 * Menus built from content: a navbar link or a footer group with `from: "<content type>"` lists that type's items
 * (title, address and first picture), so a category the owner adds shows in the menu without touching the code.
 * `links` answers a type's items as links; the runtime reads them from the database (see runtime/nav.ts).
 */
export type ItemLinks = (type: string) => Promise<NavItem[]>;

/** An item as a menu link: its title, its page and the first of `imageFields` it has a picture in. */
export function itemLink(
  item: { title: string; url: string; data: Record<string, unknown> },
  imageFields: string[],
): NavItem {
  const image = imageFields.map((name) => item.data[name] as ImageValue | undefined).find((value) => value?.src);
  return { label: item.title, href: item.url, ...(image && { image: { src: image.src, alt: image.alt ?? "" } }) };
}

/** The navbar as the site shows it: every link `from` a content type gets that type's items as its sub-links. */
export async function expandNavbar(value: NavbarValue, links: ItemLinks): Promise<NavbarValue> {
  const expand = async (items: NavItem[]): Promise<NavItem[]> =>
    Promise.all(
      items.map(async (item) =>
        item.from
          ? { ...item, children: await links(item.from) }
          : item.children
            ? { ...item, children: await expand(item.children) }
            : item,
      ),
    );
  return { ...value, items: await expand(value.items) };
}

/** The footer as the site shows it: every group `from` a content type lists that type's items. */
export async function expandFooter(value: FooterValue, links: ItemLinks): Promise<FooterValue> {
  const groups = await Promise.all(
    value.groups.map(async (group) =>
      group.from
        ? { ...group, items: (await links(group.from)).map(({ label, href }): NavLink => ({ label, href })) }
        : group,
    ),
  );
  return { ...value, groups };
}

/** The content types a menu can be built from, for the editor's choice: those whose items have pages. */
export function navSources(types: { key: string; label: string; component?: unknown; path?: string }[]): string {
  return JSON.stringify(
    types.filter((type) => type.component || type.path).map((type) => ({ value: type.key, label: type.label })),
  );
}
