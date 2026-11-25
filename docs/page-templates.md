---
title: Page templates
section: Content
order: 5
lead: The pages an owner adds later, like one per service or event, are content made from templates you write.
---

## Declare a template

Pages written in `src/pages` stay code. The pages an owner adds later are content: each one picks a template declared in `src/page-templates/index.ts`, gets its own address and title, and is edited in place like any page.

```ts
// src/page-templates/index.ts
import { definePageTemplate } from "@brimsites/brimjs";
import ServicePage from "./ServicePage.astro";

const service = definePageTemplate({
  key: "service",
  label: "Service page",
  description: "A hero with the service's name, the process and the contact form.",
  folder: "services", // "Lawn care" goes to /services/lawn-care
  component: ServicePage,
});

export const pageTemplates = [service];
```

The template is a component that receives the page as `page` (`path`, `title`, `template`) and lists its sections:

```astro
---
// src/page-templates/ServicePage.astro
import type { TemplatePageProps } from "@brimsites/brimjs";
import Site from "../layouts/Site.astro";
import PageHero from "../components/PageHero.astro";
import Contact from "../components/Contact.astro";

const { page } = Astro.props as { page: TemplatePageProps };
---
<Site title={page.title}>
  <PageHero title={page.title} />
  <Contact />
</Site>
```

The starter includes a landing page template to begin from.

## How the pages behave

- In the editor: Site map → New page (template, title, address), a delete button for each such page, and the Public/Private switch.
- Each page is private until an editor or owner publishes it, with its SEO in Page Settings.
- Two pages from one template never share edits: every node keeps the scope of its own page.
- Its address can change later in Page Settings. What was written on it moves along, and the old address redirects (301).
- Pages written in code win any address. A new page cannot take an address used by code, by a content type or by `/admin`.
- Pages whose template was removed are left out.

## For agents

`brim_list_page_templates`, `brim_create_page`, `brim_move_page` and `brim_delete_page` manage these pages over the [site MCP](./mcp.md). Adding, moving and deleting pages needs the `editor` or `owner` role.
