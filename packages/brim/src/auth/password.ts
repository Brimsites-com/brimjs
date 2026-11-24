import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const KEY_LENGTH = 64;
export const MIN_PASSWORD_LENGTH = 10; // betterleaks:allow

function derive(password: string, salt: Buffer): Promise<Buffer> { // betterleaks:allow
  return new Promise((resolve, reject) => {
    scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<string> { // betterleaks:allow
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> { // betterleaks:allow
  const [scheme, salt, key] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !key) return false;
  const expected = Buffer.from(key, "base64url");
  const actual = await derive(password, Buffer.from(salt, "base64url"));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/**
 * A password to hand over once, when an owner adds someone or resets their access: 4 groups of 5 characters from an
 * alphabet without look-alikes (~100 bits), easy to read out or copy. The emailed link lets them choose their own.
 */
export function generatePassword(): string { // betterleaks:allow
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const characters = [...randomBytes(20)].map((byte) => alphabet[byte % alphabet.length]);
  return [0, 5, 10, 15].map((start) => characters.slice(start, start + 5).join("")).join("-");
}
