// Next.js may construct an internal localhost URL behind Netlify's proxy.
// Compare browser Origin with the request Host, retaining the public protocol.
export function sameRequestOrigin(request: Request) {
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  const value = request.headers.get("origin");
  if (!value) return true;
  try {
    const origin = new URL(value), internal = new URL(request.url);
    const host = request.headers.get("host") ?? internal.host;
    const protocol = request.headers.get("x-forwarded-proto")?.split(",")[0].trim() ?? internal.protocol.slice(0, -1);
    return ["http:", "https:"].includes(origin.protocol) && origin.host === host && origin.protocol === protocol + ":";
  } catch { return false; }
}
