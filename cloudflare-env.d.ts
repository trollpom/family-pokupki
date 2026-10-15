declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    AI_SECRET_ENCRYPTION_KEY?: string;
    DEEPSEEK_API_KEY?: string;
    APP_RUNTIME?: "netlify";
  }
}
