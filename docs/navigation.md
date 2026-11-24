---
title: Navigation
section: Build
order: 4
lead: Navbar and Footer hold the site's logo, name and links, saved once for the whole site, and hand them to your markup.
---

## Navbar

`Navbar` holds the site's logo, logo text and links. `Footer` holds groups of plain links. Both hand the data to a function child and draw nothing of their own, and both are always site-wide.

A navbar item can be a group: give it `children` (sub-links, two levels deep at most) and any item an optional `image`, and the function child receives them as they are, so the site can draw a dropdown or a megamenu. The owner adds, reorders and removes links and sub-links and picks their pictures in the editor.

```astro
---
import { Navbar } from "brimjs/components";
---
<Navbar nodeId="navbar" logoText="Studio Nord" items={[
  { label: "Products", href: "/products", children: [
    { label: "Chairs", href: "/products/chairs", image: { src: "/chairs.jpg", alt: "A chair" } },
  ] },
  { label: "Contact", href: "/contact" },
]}>
  {({ items }) => (
    <nav><ul>{items.map((item) => (
      <li>
        <a href={item.href}>{item.label}</a>
        {item.children && <ul>{item.children.map((child) => (
          <li><a href={child.href}>{child.image && <img src={child.image.src} alt={child.image.alt} />}{child.label}</a></li>
        ))}</ul>}
      </li>
    ))}</ul></nav>
  )}
</Navbar>
```

## Footer

```astro
---
import { Footer } from "brimjs/components";
---
<Footer nodeId="footer" groups={[
  { title: "Studio", items: [{ label: "About", href: "/about" }, { label: "Contact", href: "/contact" }] },
]}>
  {({ groups }) => groups.map((group) => (
    <section>
      <h2>{group.title}</h2>
      <ul>{group.items.map((link) => <li><a href={link.href}>{link.label}</a></li>)}</ul>
    </section>
  ))}
</Footer>
```

Footer links stay plain `{ label, href }`.

## Menus built from content

`from: "<content type>"` on a navbar link makes its sub-links that type's items, and on a footer group its links: each item's title, its page and (in the navbar) the first picture it has, in the owner's order for an `ordered` type. A category the owner adds, renames or moves is in the menu at once, without touching the code.

```astro
<Navbar nodeId="navbar" items={[
  { label: "Products", href: "/products", from: "category" },
  { label: "Contact", href: "/contact" },
]}>…</Navbar>

<Footer nodeId="footer" groups={[{ title: "Materials", items: [], from: "category" }]}>…</Footer>
```

Never copy a list of items into a menu by hand. The owner can switch a link between the sub-links written for it and a type's items in the editor's Navigation settings. See [Vocabularies](./vocabularies.md) for lists like categories.

## Languages

On a site with several languages the navbar and footer are kept per language. See [Languages](./languages.md).
