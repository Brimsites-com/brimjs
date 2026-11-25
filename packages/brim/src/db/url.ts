/** A database address without the token it may carry (`?authToken=`), which never goes where the address goes. */
export function splitDatabaseUrl(address: string): { url: string; authToken: string | undefined } {
  const at = address.indexOf("?");
  if (at < 0 || address.startsWith("file:") || address.startsWith(":memory:")) {
    return { url: address, authToken: undefined };
  }
  let authToken: string | undefined;
  const kept = address
    .slice(at + 1)
    .split("&")
    .filter((pair) => {
      if (!/^authToken=/.test(pair)) return true;
      authToken = decodeURIComponent(pair.slice("authToken=".length).replace(/\+/g, " "));
      return false;
    });
  return { url: address.slice(0, at) + (kept.length > 0 ? `?${kept.join("&")}` : ""), authToken };
}

/** Refuses a database reached unencrypted over the internet: its token and everything read would be readable on the way. */
export function assertSecureDatabaseUrl(address: string): void {
  const plain =
    /^(?:http|ws):\/\//i.test(address) || (/^libsql:\/\//i.test(address) && /[?&]tls=0(?:&|$)/.test(address));
  if (!plain) return;
  let host: string;
  try {
    host = new URL(address.replace(/^[a-z]+:/i, "http:")).hostname;
  } catch {
    throw new Error("The database address is not a valid URL.");
  }
  if (isPrivateHost(host)) return;
  throw new Error(
    `The database at ${host} would be reached unencrypted, its token included. Use its https:// or libsql:// address; ` +
      "http:// is only for a database on this computer or in a private network.",
  );
}

/** This computer, a private network's address, or a name only a private network knows (a Docker service, say). */
function isPrivateHost(host: string): boolean {
  if (host.startsWith("[")) return host === "[::1]" || /^\[f[cd][0-9a-f]{2}:/i.test(host);
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    return /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
  }
  return !host.includes(".") || /\.(localhost|local|internal)$/i.test(host);
}
