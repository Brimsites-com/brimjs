import type { Role, User } from "./accounts.ts";

/**
 * What a signed-in user may do, checked by the editor's API (and so by the site's MCP, which goes through it):
 * - `content`: change texts, images, links, blocks and the fields of items; upload media; add private items.
 * - `publish`: publish and unpublish pages and items, and delete items.
 * - `pages`: add, rename, move and delete the pages made from templates.
 * - `templates`: change the template of a content type, shared by the pages of all its items.
 * - `responses`: read and delete what visitors sent through the site's forms.
 * - `settings`: Site Settings (email, redirects) and page passwords.
 * - `users`: add and remove the site's users, change their roles and reset their access (`/admin/api/users`, which a
 *   host's dashboard calls too). Access tokens are managed with the `brim` CLI, by whoever runs the site.
 */
export type Permission = "content" | "publish" | "pages" | "templates" | "responses" | "settings" | "users";

export const ROLES: readonly Role[] = ["owner", "editor", "writer"];

/**
 * An owner builds and runs the site; an editor runs its content (the client of an agency: writes, publishes, adds
 * pages, reads the forms) without touching its structure or settings; a writer only changes words and pictures.
 */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: ["content", "publish", "pages", "templates", "responses", "settings", "users"],
  editor: ["content", "publish", "pages", "responses"],
  writer: ["content"],
};

export function permissionsOf(role: Role): readonly Permission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

export function can(user: Pick<User, "role">, permission: Permission): boolean {
  return permissionsOf(user.role).includes(permission);
}

/** What the API answers when a user asks for something their role does not allow. */
export const REFUSALS: Record<Permission, string> = {
  content: "Your role cannot change the site's content.",
  publish: "Your role cannot publish, unpublish or delete: ask an editor or an owner of the site.",
  pages: "Your role cannot add, move or delete pages: ask an editor or an owner of the site.",
  templates: "Only the site's owners can change a content type's template.",
  responses: "Your role cannot see what visitors sent through the forms: ask an editor or an owner of the site.",
  settings: "Only the site's owners can change its settings.",
  users: "Only the site's owners can manage its users.",
};
