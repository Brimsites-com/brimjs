/** One icon of a `SocialMedia`, as its function gets it. */
export interface SocialLink {
  /** `instagram`, `facebook`, `email`… */
  network: string;
  /** What it is called: `Instagram`, or "Share on Facebook" for a share link. */
  label: string;
  href: string;
  /** The icon's drawing, for `<svg viewBox="0 0 24 24" fill="currentColor" set:html={link.icon} />`. */
  icon: string;
  /** Whether it opens in a new tab: profiles unless turned off, share links always. */
  newTab: boolean;
}

export interface SocialMediaValue {
  links: SocialLink[];
}
