import type { NavItem } from "brimjs";

export const SITE_NAME = "{{siteName}}";

/** The starting navigation. Once the owner reorders or renames links in the editor, their version is used. */
export const pages: NavItem[] = [
  { label: "Home", href: "/" },
  { label: "About", href: "/about" },
  { label: "Blog", href: "/blog" },
  { label: "Components", href: "/components" },
  { label: "Contact", href: "/contact" },
];
