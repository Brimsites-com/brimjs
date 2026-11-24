/** The page is drawn inside Brim's editor. */
export function inEditor(): boolean {
  try {
    return window.self !== window.top && (window.top?.location.pathname.startsWith("/admin/edit") ?? false);
  } catch {
    return false;
  }
}
