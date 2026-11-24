import type { SocialIconName } from "./social-icons.ts";

export type SharePayload = {
  url: string;
  title: string;
  text: string;
};

export type SocialNetworkConfig = {
  key: string;
  label: string;
  icon: SocialIconName;
  profileField: string;
  allowedHosts?: string[];
  allowedProtocols?: string[];
  share?: (payload: SharePayload) => string;
};

export type SocialActionItem = SocialNetworkConfig & {
  actionUrl: string;
  actionKind: "share" | "profile";
};

export const SOCIAL_NETWORKS: SocialNetworkConfig[] = [
  {
    key: "facebook",
    label: "Facebook",
    icon: "facebook",
    profileField: "facebookUrl",
    allowedHosts: ["facebook.com", "fb.com"],
    share: ({ url }) => `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
  },
  {
    key: "x",
    label: "X",
    icon: "x",
    profileField: "xUrl",
    allowedHosts: ["x.com", "twitter.com"],
    share: ({ url, text }) =>
      `https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`,
  },
  {
    key: "linkedin",
    label: "LinkedIn",
    icon: "linkedin",
    profileField: "linkedinUrl",
    allowedHosts: ["linkedin.com"],
    share: ({ url }) => `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`,
  },
  {
    key: "whatsapp",
    label: "WhatsApp",
    icon: "whatsapp",
    profileField: "whatsappUrl",
    allowedHosts: ["wa.me", "whatsapp.com", "api.whatsapp.com"],
    share: ({ url, text }) => `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`,
  },
  {
    key: "telegram",
    label: "Telegram",
    icon: "telegram",
    profileField: "telegramUrl",
    allowedHosts: ["t.me", "telegram.me", "telegram.org"],
    share: ({ url, text }) => `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`,
  },
  {
    key: "pinterest",
    label: "Pinterest",
    icon: "pinterest",
    profileField: "pinterestUrl",
    allowedHosts: ["pinterest.com"],
    share: ({ url, text }) =>
      `https://pinterest.com/pin/create/button/?url=${encodeURIComponent(url)}&description=${encodeURIComponent(text)}`,
  },
  {
    key: "reddit",
    label: "Reddit",
    icon: "reddit",
    profileField: "redditUrl",
    allowedHosts: ["reddit.com"],
    share: ({ url, text }) =>
      `https://www.reddit.com/submit?url=${encodeURIComponent(url)}&title=${encodeURIComponent(text)}`,
  },
  {
    key: "instagram",
    label: "Instagram",
    icon: "instagram",
    profileField: "instagramUrl",
    allowedHosts: ["instagram.com"],
  },
  {
    key: "youtube",
    label: "YouTube",
    icon: "youtube",
    profileField: "youtubeUrl",
    allowedHosts: ["youtube.com", "youtu.be"],
  },
  {
    key: "tiktok",
    label: "TikTok",
    icon: "tiktok",
    profileField: "tiktokUrl",
    allowedHosts: ["tiktok.com"],
  },
  {
    key: "github",
    label: "GitHub",
    icon: "github",
    profileField: "githubUrl",
    allowedHosts: ["github.com"],
  },
  {
    key: "discord",
    label: "Discord",
    icon: "discord",
    profileField: "discordUrl",
    allowedHosts: ["discord.gg", "discord.com"],
  },
  {
    key: "twitch",
    label: "Twitch",
    icon: "twitch",
    profileField: "twitchUrl",
    allowedHosts: ["twitch.tv"],
  },
  {
    key: "vimeo",
    label: "Vimeo",
    icon: "vimeo",
    profileField: "vimeoUrl",
    allowedHosts: ["vimeo.com"],
  },
  {
    key: "dribbble",
    label: "Dribbble",
    icon: "dribbble",
    profileField: "dribbbleUrl",
    allowedHosts: ["dribbble.com"],
  },
  {
    key: "email",
    label: "Email",
    icon: "email",
    profileField: "emailUrl",
    allowedProtocols: ["mailto"],
  },
  {
    key: "phone",
    label: "Phone",
    icon: "phone",
    profileField: "phoneUrl",
    allowedProtocols: ["tel"],
  },
];

export const DEFAULT_SOCIAL_NETWORK_ORDER = SOCIAL_NETWORKS.map((network) => network.key);

export function normalizeSocialNetworkOrder(value: unknown): string[] {
  const seen = new Set<string>();
  const validKeys = new Set(DEFAULT_SOCIAL_NETWORK_ORDER);
  const ordered = Array.isArray(value)
    ? value.filter((key): key is string => {
        if (typeof key !== "string" || !validKeys.has(key) || seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      })
    : [];

  return [...ordered, ...DEFAULT_SOCIAL_NETWORK_ORDER.filter((key) => !seen.has(key))];
}

export function orderSocialNetworks(networks: SocialNetworkConfig[], value: unknown): SocialNetworkConfig[] {
  const order = normalizeSocialNetworkOrder(value);
  const rank = new Map(order.map((key, index) => [key, index]));

  return [...networks].sort(
    (a, b) => (rank.get(a.key) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.key) ?? Number.MAX_SAFE_INTEGER),
  );
}

function hasValidHttpHostname(url: URL): boolean {
  const hostname = url.hostname.trim();
  if (!hostname) return false;
  if (hostname === "localhost") return true;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return true;
  if (hostname.includes(":")) return true;
  return hostname.includes(".") && !hostname.includes("_");
}

export function normalizeSocialProfileUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";

  const protocolMatch = trimmed.match(/^([a-z][a-z0-9+.-]*):/i);
  const protocol = protocolMatch?.[1]?.toLowerCase();
  if (protocol && !["http", "https", "mailto", "tel"].includes(protocol)) {
    return "";
  }

  if (protocol === "mailto") {
    const address = trimmed.slice("mailto:".length);
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) ? trimmed : "";
  }

  if (protocol === "tel") {
    const phone = trimmed.slice("tel:".length);
    return /^[+()0-9.\-\s]{3,}$/.test(phone) ? trimmed : "";
  }

  if (/\s/.test(trimmed)) return "";

  const candidate = trimmed.startsWith("//") ? `https:${trimmed}` : protocol ? trimmed : `https://${trimmed}`;

  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    if (!hasValidHttpHostname(url)) return "";
    return url.toString();
  } catch {
    return "";
  }
}

function isAllowedNetworkHostname(url: URL, allowedHosts: string[]): boolean {
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  return allowedHosts.some((host) => {
    const normalizedHost = host.toLowerCase();
    return hostname === normalizedHost || hostname.endsWith(`.${normalizedHost}`);
  });
}

export function normalizeSocialNetworkProfileUrl(networkKey: string, value: unknown): string {
  const normalized = normalizeSocialProfileUrl(value);
  if (!normalized) return "";

  const network = SOCIAL_NETWORKS.find((item) => item.key === networkKey);
  if (!network) return normalized;

  const protocol = normalized.match(/^([a-z][a-z0-9+.-]*):/i)?.[1] || "";
  if (network.allowedProtocols?.length) {
    return network.allowedProtocols.includes(protocol.toLowerCase()) ? normalized : "";
  }

  if (!network.allowedHosts?.length) return normalized;

  try {
    const url = new URL(normalized);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return isAllowedNetworkHostname(url, network.allowedHosts) ? normalized : "";
  } catch {
    return "";
  }
}
