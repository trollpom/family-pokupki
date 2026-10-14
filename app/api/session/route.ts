import { env } from "cloudflare:workers";
import { checkNetlifyPassword, createNetlifySession, netlifyAuthConfigured, sessionCookie } from "../../../lib/netlify-auth";
import { sameRequestOrigin } from "../../../lib/request-origin";
export const dynamic = "force-dynamic";
const redirect = (location: string, cookie?: string) => new Response(null, {
  status: 303, headers: { Location: location, "Cache-Control": "no-store", ...(cookie ? { "Set-Cookie": cookie } : {}) },
});
export async function POST(request: Request) {
  if (env.APP_RUNTIME !== "netlify") return new Response(null, { status: 404 });
  if (!netlifyAuthConfigured()) return Response.json({ error: "Личный вход ещё не настроен" }, { status: 503 });
  if (!sameRequestOrigin(request)) return new Response(null, { status: 403 });
  if (!request.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded")) return new Response(null, { status: 415 });
  const body = await request.text();
  if (body.length > 4000) return new Response(null, { status: 413 });
  const password = new URLSearchParams(body).get("password") ?? "";
  if (!await checkNetlifyPassword(password)) {
    await new Promise(resolve => setTimeout(resolve, 250));
    return redirect("/login?error=invalid");
  }
  return redirect("/", sessionCookie(await createNetlifySession()));
}
export async function GET() {
  if (env.APP_RUNTIME !== "netlify") return new Response(null, { status: 404 });
  return redirect("/login", sessionCookie(""));
}
