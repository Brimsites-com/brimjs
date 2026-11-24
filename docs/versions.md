---
title: Versions and license
section: Run
order: 5
lead: How Brim.js versions change, how a site's database moves forward, and what the license allows.
---

## Versions

Changes are listed in [CHANGELOG.md](../CHANGELOG.md). Versions are semantic: only a major version may break the API of components and config, and says so there under Changed; a minor version adds, a patch version fixes.

A site pins its range in `package.json`:

```json
"dependencies": { "brimjs": "^1.0.0" }
```

## The database moves forward by itself

Database migrations are append-only, and released ones are never edited. When a newer Brim.js opens a site's database it brings it forward by itself. There is no way back, so back up `.brim/data.db` before updating.

`GET /admin/api/info` names the schema version, so a host can check a site against what it supports before putting it live.

## License

Brim.js is released under the Functional Source License, Version 1.1, MIT Future License (FSL-1.1-MIT).

- Building sites with Brim.js, for yourself or for clients, and hosting your own sites are permitted.
- Offering Brim.js, or a product with substantially the same functionality (such as managed hosting of Brim.js sites), to others commercially is not.
- Two years after each release, that release is also available under the MIT license.

The sites you make with `create-brim` are yours, under the license you choose.
