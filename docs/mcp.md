---
title: Site MCP
section: Run
order: 2
lead: Every Brim.js site serves its own MCP at /admin/mcp, so AI agents can read and change content with the same checks as the editor.
---

## Connect an AI app by signing in

ChatGPT, Claude and other apps that sign in to MCP servers (OAuth) need nothing but the address:

1. Add a custom connector (an MCP server) in the app with `https://your-site.com/admin/mcp`. In ChatGPT choose OAuth as its authentication.
2. The app opens the site's sign-in page. Sign in with your account on the site and choose **Allow**.
3. Ask for changes in the chat. The app acts as you, with what your role allows.

The app stays connected: its access token works for an hour and the app renews it on its own, with nothing to do. A connection ends only when someone disconnects it, in the editor's menu (**Connected apps**, where an owner sees everyone's) or at `DELETE /admin/api/connections/<id>`, or when its user changes their password, has their access reset with tokens revoked, or is removed.

What the site serves for it, for any MCP client:

| Address | What it is |
| --- | --- |
| `/.well-known/oauth-protected-resource` (and `…/admin/mcp`) | The MCP's protected-resource metadata (RFC 9728); a 401 from the MCP points here |
| `/.well-known/oauth-authorization-server` | The site as its own authorization server (RFC 8414) |
| `/admin/oauth/register` | Dynamic client registration (RFC 7591), open to any app, slowed down per address |
| `/admin/oauth/authorize` | Sign-in and consent; authorization code with PKCE S256 only |
| `/admin/oauth/token`, `/admin/oauth/revoke` | Tokens and refresh (the refresh token changes on every use), revocation (RFC 7009) |

A host that puts a CDN in front of the site sends `/.well-known/oauth-*` straight to the site's server, uncached, like `/admin`. `/admin/api/info` lists the capability `oauth`; `GET /admin/api/connections` answers the MCP's address and the user's connected apps (`?all` for an owner).

## Connect a client with a token

Tools that do not sign in (Claude Code, Codex, Cursor, scripts) use an access token, which acts as one of the site's users and may do what that user's role allows. Tokens work as they always did, beside OAuth.

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
| `brim_update_page` | Visibility and SEO of a page; title of a template page |
| `brim_list_page_templates`, `brim_create_page`, `brim_move_page`, `brim_delete_page` | Pages added from templates |
| `brim_list_redirects`, `brim_set_redirects` | The site's redirects |
| `brim_list_items`, `brim_create_item`, `brim_update_item`, `brim_delete_item` | Items of content types; filter by `tag` and `locale` |
| `brim_translate_item` | A private translation of an item, linked to it |
| `brim_reorder_items` | The order of an ordered type's items |
| `brim_list_media`, `brim_upload_image` | The media library: search it, add to it from a public address or base64 |
| `brim_list_form_responses` | Form messages, newest first |
| `brim_list_history`, `brim_restore_history` | The latest changes, and taking one back |

`brim_set_text` keeps a `\n` as a line break and takes `rich` to keep or add formatting. A batch holds at most 20 requests, run one after another.

## Writing articles and other items

The MCP tells every client how a site's content is shaped, so an app writing an article puts things where they show:

- A `richtext` field holds text only. Text with pictures between its paragraphs goes in a `blocks` field, as `richtext` and `image` blocks in reading order. A type that should take such texts declares a `blocks` field; its `help` can say so, since clients read it.
- `brim_site` names each type's `previewImage`: the field with the picture on cards, in feeds and in shared links (the standard `image`, or the first image field of a type that set `image: false`). Clients are asked to fill it for every new item.

## What to know

- Changes through the MCP are saved at once, with no draft. Read a page (`brim_read_page`) before changing it, and use `brim_list_history` and `brim_restore_history` to take a change back.
- The role decides what a token can do. A refused call names the role that can.
- Revoke a token at any time with `brim token revoke <email> <name>`, and disconnect an app in the editor's menu (Connected apps).

## Why every site has one

The agent that built the site can come back months later to update copy, add a project or read new messages, without touching the code or the database. The guides that ship with Brim.js tell coding agents to offer, after a first deploy, to save the live site's MCP in the client.
