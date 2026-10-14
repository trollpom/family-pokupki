import type { ChatGPTUser } from "../app/chatgpt-auth";

export const SESSION_COOKIE = "__Host-sobrano";
const lifetime = 7 * 24 * 60 * 60;
const encoder = new TextEncoder();
export function netlifyAuthConfigured() {
  return (process.env.APP_PASSWORD?.length ?? 0) >= 16 && (process.env.APP_SESSION_SECRET?.length ?? 0) >= 32;
}
function encode(bytes: Uint8Array) {
  return btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(""))
    .replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
function decode(value: string) {
  return Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), c => c.charCodeAt(0));
}
async function signingKey() {
  if (!netlifyAuthConfigured()) throw new Error("Private login is not configured");
  return crypto.subtle.importKey("raw", encoder.encode(process.env.APP_SESSION_SECRET + "\0" + process.env.APP_PASSWORD),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
export async function checkNetlifyPassword(password: string) {
  if (!netlifyAuthConfigured()) return false;
  const [a, b] = await Promise.all([password, process.env.APP_PASSWORD!].map(value => crypto.subtle.digest("SHA-256", encoder.encode(value))));
  const left = new Uint8Array(a), right = new Uint8Array(b);
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
  return difference === 0;
}
export async function createNetlifySession(now = Date.now()) {
  const payload = encode(encoder.encode(JSON.stringify({ sub: "netlify-owner", exp: Math.floor(now / 1000) + lifetime })));
  const signature = await crypto.subtle.sign("HMAC", await signingKey(), encoder.encode(payload));
  return payload + "." + encode(new Uint8Array(signature));
}
export async function netlifyUser(headers: Headers, now = Date.now()): Promise<ChatGPTUser | null> {
  if (!netlifyAuthConfigured()) return null;
  const token = headers.get("cookie")?.split(";").map(p => p.trim()).find(p => p.startsWith(SESSION_COOKIE + "="))?.slice(SESSION_COOKIE.length + 1);
  if (!token || token.length > 2048) return null;
  try {
    const parts = token.split(".");
    if (parts.length !== 2 || !/^[A-Za-z0-9_.-]+$/.test(token)) return null;
    const [payload, signature] = parts;
    if (!await crypto.subtle.verify("HMAC", await signingKey(), decode(signature), encoder.encode(payload))) return null;
    const data = JSON.parse(new TextDecoder().decode(decode(payload))), seconds = Math.floor(now / 1000);
    if (data.sub !== "netlify-owner" || !Number.isInteger(data.exp) || data.exp <= seconds || data.exp > seconds + lifetime) return null;
    return { userId: "netlify-owner", displayName: "Моя семья", email: "owner@local.invalid", fullName: "Моя семья" };
  } catch { return null; }
}
export function sessionCookie(token: string) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${token ? lifetime : 0}`;
}
