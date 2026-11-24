---
title: Site MCP
section: Run
order: 2
lead: Every Brim.js site serves its own MCP at /admin/mcp, so AI agents can read and change content with the same checks as the editor.
---

## Connect a client

The MCP needs an access token, which acts as one of the site's users and may do what that user's role allows.

```bash
npx brim token add you@example.com --name claude
claude mcp add --transport http my-site http://localhost:4321/admin/mcp \
  --header "Authorization: Bearer <token>"
```

Any client that speaks MCP over HTTP works the same way, Codex and Cursor included. On a deployed site, make the token where its database is and use the site's address. Keep the token in your client's settings, never in a file of the project. The same token works as a bearer token on the editor's API under `/admin/api`.

## Tools

| Tool | What it does |
| --- | --- |
| `brim_site` | Pages, content types with their fields, page templates |
| `brim_site_settings`, `brim_set_site_settings` | The site's own settings |
| `brim_read_page` | A page's editable elements: nodeId, kind, scope, text with its formatting (`rich`), settings |
| `brim_page_content` | What the owner saved on a page, before its code changes |
| `brim_set_text`, `brim_set_element`, `brim_reset_element` | Change or reset an element; block settings are merged |
| `brim_block_schema` | The settings a block accepts |
| `brim_update_page` | Visibility, SEO and password of a page; title of a template page |
| `brim_list_page_templates`, `brim_create_page`, `brim_move_page`, `brim_delete_page` | Pages added from templates |
| `brim_list_redirects`, `brim_set_redirects` | The site's redirects |
| `brim_list_items`, `brim_create_item`, `brim_update_item`, `brim_delete_item` | Items of content types; filter by `tag` and `locale` |
| `brim_translate_item` | A private translation of an item, linked to it |
| `brim_reorder_items` | The order of an ordered type's items |
| `brim_list_media`, `brim_upload_image` | The media library: search it, add to it from a public address or base64 |
| `brim_list_form_responses` | Form messages, newest first |
| `brim_list_history`, `brim_restore_history` | The latest changes, and taking one back |

`brim_set_text` keeps a `\n` as a line break and takes `rich` to keep or add formatting. A batch holds at most 20 requests, run one after another.

## What to know

- Changes through the MCP are saved at once, with no draft. Read a page (`brim_read_page`) before changing it, and use `brim_list_history` and `brim_restore_history` to take a change back.
- The role decides what a token can do. A refused call names the role that can.
- Revoke a token at any time with `brim token revoke <email> <name>`.

## Why every site has one

The agent that built the site can come back months later to update copy, add a project or read new messages, without touching the code or the database. The guides that ship with Brim.js tell coding agents to offer, after a first deploy, to save the live site's MCP in the client.
