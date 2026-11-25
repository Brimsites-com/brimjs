---
title: Users and tokens
section: Run
order: 1
lead: Users and access tokens are managed from the command line in the site's folder, where its database is.
---

## Add users

```bash
npx brim user add you@example.com
npx brim user add ana@example.com --role editor
npx brim user link ana@example.com   # a one-time sign-in link instead of a password
```

There is no users screen in the editor. Owners run everything and editors run the content; the API and the site MCP enforce it. See [Editing and handover](./editing.md) for the full table.

## Commands

| Command | What it does |
| --- | --- |
| `brim user add <email> [--role owner\|editor]` | Create a user; the password is asked for or read from stdin |
| `brim user list [--json]` | Users with their role and tokens |
| `brim user role <email> <role>` | Change a role; a site always keeps one owner |
| `brim user link <email>` | A link that signs them in once, within two minutes |
| `brim user password <email>` | Set a new password; ends their sessions and tokens |
| `brim user remove <email>` | Delete a user with their sessions and tokens |
| `brim token add <email> [--name <name>]` | Create an MCP access token, shown once |
| `brim token list <email>` | A user's tokens |
| `brim token revoke <email> <name>` | Delete a token; clients using it stop working |

Run them where the site's database is: in the project folder for the local site, on the server for a site you host. Users also reset and change their own passwords from the editor; see [Editing and handover](./editing.md).

## In scripts

Passwords are read from stdin when it is not a terminal:

```bash
printf %s "$OWNER_PASSWORD" | npx brim user add owner@example.test
```

Never write passwords or tokens into the project's files. `brim check` reports a password in a file as an error. To let someone sign in without passing a password around, give them `npx brim user link <email>`.

## On a host

A host can manage users its own way. On Brimsites the same users and roles are managed from a table in the dashboard or with the `brimsites` CLI, and the sign-in form offers Continue with Brimsites. A host adds that button with `BRIM_HOST_SIGN_IN_URL` and `BRIM_HOST_SIGN_IN_NAME`.
