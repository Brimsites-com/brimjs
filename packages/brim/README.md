# Brim.js

Makes Astro sites editable. You write pages in Astro with components that carry a stable `nodeId`; the owner edits
their words, pictures and links in the browser, and the content lives in SQLite.

```bash
npm create brim@latest my-site   # a new site
npx @brimsites/brimjs init                  # in an Astro project you already have
```

```astro
---
import { Text, Image, Link } from "@brimsites/brimjs/components";
---

<Text nodeId="hero-title" as="h1">Websites your clients can edit</Text>
<Image nodeId="hero-image" src="/hero.jpg" alt="The studio at work" />
<Link nodeId="hero-cta" href="/about">Meet the studio</Link>
```

Documentation: https://brimjs.com/docs

Source available under the Functional Source License (FSL-1.1-MIT); see `LICENSE`.
