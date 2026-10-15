import { NetlifyD1 } from "./sqlite-d1";

// Next.js replaces only the Cloudflare module; the existing service/schema
// layer keeps its async D1 interface. Secrets stay in Functions environment.
export const env: Cloudflare.Env = {
  APP_RUNTIME: "netlify",
  DB: new NetlifyD1() as unknown as D1Database,
  get AI_SECRET_ENCRYPTION_KEY() { return process.env.AI_SECRET_ENCRYPTION_KEY; },
  get DEEPSEEK_API_KEY() { return process.env.DEEPSEEK_API_KEY; },
};
