---
title: Editing and handover
section: Start
order: 3
lead: How the owner edits, with drafts, roles the API enforces and 90 days of history to take anything back.
---

## Finding the editor

The editor lives on the site itself at `/admin/edit` (for example `/admin/edit/about`). Nobody has to remember that:

- Every page shows a floating Edit this page button to whoever may edit: everyone on the dev server, and on the live site anyone signed in. Visitors never see it, and those pages are never cached for anyone else.
- `?edit` after any address opens that page in the editor, on the dev server and online. `/admin` and `/edit` open it too, unless the site has a page there.
- `npx brim open` opens the editor in your browser already signed in, with a one-time link. `--page /about` opens a page, `--url https://example.com` the live site.

The public pages carry no editor script and no editor markup.

## Drafts, Save and Undo

What is changed in the editor does not reach visitors at once. It waits in a draft, one for the whole site, that only the editor's preview shows.

| Action | What it does |
| --- | --- |
| Save (⌘S) | Writes the draft to the site and to its history |
| Discard | Throws the draft away |
| Undo, Redo (⌘Z, ⇧⌘Z) | Step through the changes made in the window; while typing, ⌘Z undoes the typing first |

Publishing or hiding a page or an item, and changes made in the content browser, still apply at once. The site MCP and scripts that call the API save at once too; the API takes `draft: true` to hold a change in the draft instead.

Typed text is never lost: opening another page, a redraw and Save all save the open text first, leaving the tab warns while something is still unsaved, and an expired session opens a Sign in again dialog over the editor and sends the refused change once you are back.

## Editing on the page

- Click a text and type. The text toolbar sets bold, italic, links and colors; what a Text may hold is described in [Components and nodeId](./components.md).
- Click an image, button, gallery or other block to change it in the side panel.
- Text pasted or dropped from Word, Google Docs or another page comes in clean.
- The page works with the keyboard: Tab moves through the editable elements, Enter or Space selects, Escape lets go, F6 moves between the page and the side panel. The selection is announced to screen readers.
- Japanese, Chinese and other input methods work as expected: Enter that confirms a candidate does not add a line or submit.

## Roles

A user's role decides what the editor offers them and what the API, and so the site MCP, lets them do. A refused request names the role that can do it.

| Role | For | May |
| --- | --- | --- |
| `owner` | Whoever builds and runs the site | Everything below, plus content type templates, users, redirects and the email in Site Settings |
| `editor` | Whoever runs its content: the client | Texts, images, links, blocks, SEO, item fields and site settings; upload media; add, publish, unpublish and delete items; add, move and delete pages; read form messages |

```bash
npx brim user add ana@client.com --role editor
npx brim user role ana@client.com owner
```

The rule lives in one place, `ROLE_PERMISSIONS`, exported from `brimjs`, and `GET /admin/api/session` answers the signed-in user's permissions. Users are managed from the command line; see [Users and tokens](./users-and-tokens.md).

## Passwords

Users manage their own:

- Forgot password? on the sign-in form emails a link that sets a new password. It works once, for an hour, and the answer is the same whether the email has an account or not. It is sent the way the site sends its form emails, so it needs an email setup (see [Forms](./forms.md)), and the link uses the site's `site` address.
- Change password, in the editor's menu, asks for the current one.

A new password, either way, signs the user out everywhere else.

## History

Every saved change of content is kept for 90 days (the latest 5,000 changes at most): an element changed or reset, an item changed or deleted, a page deleted with everything written on it. History, in the editor's account menu, lists them for the page or the whole site, with who made each and when.

Restore puts it back as it was before that change. A restored page comes back private, and a restore can be taken back too. Saves of the same thing by the same person within ten minutes count as one change. Restoring needs the role the change itself needs.

## The editor on any screen

The editor works on tablets and phones. On a computer the side panel can be dragged wider, and the page preview set to any width between a phone and the whole window. The ⋯ menu switches the editor between system, light and dark; the page being edited keeps the site's look.
